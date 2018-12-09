//initialize micro-database to save session data and configuration file
var config = require("./config.json");
var loki = require("lokijs");
var fs = require("fs");
var db = new loki("db.json", {
	autosave: true
});


var sha512 = require("js-sha512");
var moment = require("moment");
var path = require("path");

module.exports = function Socket(io, udpServer) {

    //set address of target board
    const BOARD_ADDRESS = "192.168.3.15";

    //init new collection
    var sessionCollection = db.addCollection("sessions");
    var managerCollection = db.addCollection("manager");
    sessionCollection.chain().remove();
    managerCollection.chain().remove();

    var luminosityCollection = db.addCollection("luminosities");

    //Socket.io server handle new connection
    io.on("connection", function (socket) {
        var isReceiveLightSensor = true;
        var clientToken = "";
        var intervalDelay = 1000;
        var isLogin = false;
        var update = undefined;
        var updatelight = undefined;
    
        function updateStatistic() {
            var serverDate = moment().format("DD/MM/YYYY HH:mm");
            var json = {
                serverTime: serverDate,
                deviceTime: serverDate,
                lightStatus: true,
                lightIntensity: 0
            };
    
            socket.emit("statistic", json);
        }
    
        function startUpdateStatistic() {
            update = setInterval(updateStatistic, 1000);
        }
    
        console.log("Client ID " + socket.id + " connected");
        socket.on("command", function (command) {
            var commandData = JSON.parse(command);
            if (commandData.type === "login") {
                var check = sessionCollection.findOne({
                    clientId: socket.id,
                    address: socket.handshake.address
                });
                if (!check) {
                    var credential = commandData.credential;
                    var username = credential.username;
                    var password = credential.password;
                    if (username !== config.credential.username) {
                        socket.emit("err", {
                            code: 401,
                            error: "Invalid username"
                        });
                        isLogin = false;
                    } else if (sha512(password) !== config.credential.password) {
                        socket.emit("err", {
                            code: 401,
                            error: "Invalid password"
                        });
                        isLogin = false;
                    } else {
                        if (!commandData.token) {
                            var token = sha512.sha384(new Date().getMilliseconds().toString());
                            session = {
                                token: token,
                                time: moment().toISOString(true),
                                clientId: socket.id,
                                address: socket.handshake.address
                            }
                            sessionCollection.insert(session);
    
                            clientToken = token;
                            socket.emit("login_success", {
                                message: "Login success",
                                token: token
                            });
                            sendAddSession(session)
                            isLogin = true;
                            console.log("Client " + socket.id + " logged in");
                            updateStatistic();
                            startUpdateStatistic();
                        } else {
                            socket.emit("err", {
                                error: "Sorry! You're already login",
                                code: 406
                            });
                        }
                    }
                } else {
                    socket.emit("err", {
                        error: "Sorry! You're already login",
                        code: 406
                    });
                }
            } else if (commandData.type === "logout") {
                console.log(command);
                if (commandData.token) {
                    var s = sessionCollection.find({
                        token: commandData.token
                    })
                    sessionCollection.findAndRemove({
                        token: commandData.token
                    });
    
                    sendRemoveSession(s);
                    
                    socket.emit("logout_success", {
                        message: "Logout success",
                        time: new Date().toJSON()
                    });
                    isLogin = false;
                    
                    clearInterval(update);
                } else {
                    socket.emit("err", {
                        error: "You must login before logout",
                        code: 400
                    });
                }
            } else if (commandData.type === "control") {
                if (commandData.token) {
                    var exists = sessionCollection.findOne({
                        token: commandData.token
                    });
                    if (exists) {
                        delete commandData.token;
                        delete commandData.type;
                        config.control_config = commandData;
                        fs.writeFile(
                            "./config.json",
                            JSON.stringify(config),
                            "utf8",
                            function (err) {
                                if (err) {
                                    console.error(err.message);
                                } else {
                                    console.log("Configuration saved");
                                }
                            }
                        );
                        var json = {
                            type: "control",
                            value: config.control_config
                        };
                        var buff = JSON.stringify(json);
                        udpServer.send(buff, 0, buff.length, udpPort, BOARD_ADDRESS);
                    } else {
                        socket.emit("err", {
                            error: "Unauthorization",
                            code: 401
                        });
                    }
                } else {
                    console.log(121);
                    socket.emit("err", {
                        error: "Unauthorization",
                        code: 401
                    });
                }
            } else if (commandData.type === "request") {
                var exists = sessionCollection.findOne({
                    token: commandData.token
                });
                console.log(commandData);
                if (exists) {
                    socket.emit("control_config", config.control_config);
                }
            } else {
                socket.emit("err", {
                    error: "Invalid command",
                    code: 400
                });
            }
        });
    
        socket.on("manager_login", function (passcode) {
            console.log(passcode)
            if (passcode != null || passcode != undefined || !passcode != NaN) {
                if (passcode === config.security_code) {
                    var sessions = sessionCollection.find({});
                    
                    socket.emit("manager_accepted");
                    var json = {
                        sessions,
                        config
                    }
                    managerCollection.insert({
                        clientId: socket.client.id,
                        time: moment().toISOString(true)
                    })
                    socket.emit("manage_data", JSON.stringify(json));
                }
                else {
                    socket.emit("manager_unauthorized", {
                        message: "Invalid Security Code"
                    })
                }
            }
        });
    
        socket.on("config", function (config) {
            console.log(config);
            if (config) {
                var configData = JSON.parse(config);
    
                if (configData.token) {
                    var exists = sessionCollection.findOne({
                        token: configData.token
                    });
                    if (exists) {
                        var value = configData.value;
                        if ((value = null || value === undefined || value === NaN)) {
                            socket.emit("err", {
                                error: "Missing 'value' field or invalid value",
                                code: 400
                            });
                        } else {
                            if (configData.type !== null || configData.type === undefined) {
                                var dataSend = {
                                    type: "config",
                                    cmd: configData.type,
                                    value: value
                                };
                                console.log(configData.type);
    
                                if (configData.type === "sensor_state") {
                                    isReceiveLightSensor = configData.value === 1;
                                }
                                var buff = new Buffer(JSON.stringify(dataSend));
                                udpServer.send(buff, 0, buff.length, udpPort, BOARD_ADDRESS);
                            }
                        }
                    } else {
                        socket.emit("err", {
                            error: "Unauthorization",
                            code: 401
                        });
                    }
                } else {
                    socket.emit("err", {
                        error: "Unauthorization",
                        code: 401
                    });
                }
            }
        });
    
        socket.on("end_session", function(sessionId) {
            if(sessionId != null || session != undefined) {
                sessionCollection.findAndRemove({
                    clientId: sessionId
                })
                io.clients().connected[sessionId.toString()].disconnect();
            }
        })
    
        udpServer.on("message", function (msg, cinfo) {
            if (isLogin && isReceiveLightSensor) {
                var data = JSON.parse(msg);
                console.log(data);
                luminosityCollection.insert({
                    time: data.time,
                    value: data.value
                });
                socket.emit("light", {
                    time: data.time,
                    value: data.value
                });
            }
        });
    
        socket.on("signal", function (signal) {
            var signalData = JSON.parse(signal);
    
            var username = signalData.username;
            var password = signalData.password;
    
            if (username !== config.credential.username) {
                socket.emit("err", {
                    code: 401,
                    error: "INVALID_USERNAME"
                });
            } else if (sha512(password) !== config.credential.password) {
                socket.emit("err", {
                    code: 401,
                    error: "INVALID_PASSWORD"
                });
            } else {
                socket.emit("signal_ok", {
                    status: true
                });
            }
        });
    
        socket.on("disconnect", function () {
            checkIsManager = managerCollection.find({
                clientId: socket.id
            })
    
            if(checkIsManager.length === 0) {
                
                if (clientToken !== "") {
                    var s = sessionCollection.findOne({
                        clientId: socket.id
                    })
    
                    if(s) {
                        sessionCollection.findAndRemove({
                            clientId: socket.id
                        });
                        clearInterval(update);
                        sendRemoveSession(s);
                        console.log("client " + socket.id + " logout and disconnected");
                    }
                    
                }
            }
            
        });
    });
    
    function sendRemoveSession(session) {
        managers = managerCollection.find({})
        managers.forEach(manager => {
            io.to(manager.clientId).emit("session_remove", JSON.stringify(session))
        });
    }
    
    function sendAddSession(session) {
        managers = managerCollection.find({})
        managers.forEach(manager => {
            io.to(manager.clientId).emit("session_join", JSON.stringify(session))
        });
    }
    
    // handle connect error
    io.on("error", function (error) {
        console.error(error);
    });
}
