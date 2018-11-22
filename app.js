var sha512 = require('js-sha512');
var moment = require('moment')

//initialize micro-database to save session data and configuration file
var config = require('./config.json');
var loki = require('lokijs');
var fs = require('fs')
var db = new loki('db.json', {
    autosave: true,
})


//init UDP socket server
var dgram = require('dgram');
const udpPort = 12000;
var udpServer = dgram.createSocket('udp4')
udpServer.bind(udpPort)


//init HTTP server and Socket.io module
const httpPort = 13000;
var cookieParser = require('cookie-parser');
const bodyParser = require('body-parser'); 
var logger = require('morgan');
var session = require('express-session')
var express = require('express')
var qs = require('qs')
var app = express();
var server = require('http').createServer(app);
var io = require('socket.io')(server);

app.use(logger('dev'));
app.use(bodyParser.urlencoded({ extended: false }));  
app.use(bodyParser.json());

app.use(cookieParser());

app.use(session({
    secret: 'quoc96@@',
    resave: false,
    saveUninitialized: true,
    cookie: {
        secure: true
    }
}))

app.set('query parser', function (str) {
    return qs.parse(str, { decoder: function (s) { return decodeURIComponent(s); } });
  });


server.listen(httpPort, function () {
    console.log("Socket IO is running... Port: " + httpPort)
})

//set address of target board
const BOARD_ADDRESS = '192.168.3.15'

//init new collection
var sessionCollection = db.addCollection('sessions')
var luminosityCollection = db.addCollection('luminosities');

// UDP socket server listen
udpServer.on('listening', function () {
    console.log('UDP server is listening... Port: ' + udpPort)
})

//Socket.io server handle new connection
io.on('connection', function (socket) {

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
            lightIntensity: Math.random() * (105.9 - 0.1) + 0.1
        };

        socket.emit('statistic', json);
    }

    function startUpdateStatistic() {
        update = setInterval(updateStatistic, 1000)
        
    }


    console.log("Client ID " + socket.id + " connected")
    socket.on('command', function (command) {

        var commandData = JSON.parse(command);
        if (commandData.type === 'login') {
            var check = sessionCollection.findOne({
                clientId: socket.id,
                address: socket.handshake.address
            })
            if (!check) {
                var credential = commandData.credential;
                var username = credential.username;
                var password = credential.password;
                if (username !== config.credential.username) {
                    socket.emit('err', {
                        code: 401,
                        error: "Invalid username"
                    });
                    isLogin = false;
                } else if (sha512(password) !== config.credential.password) {
                    socket.emit('err', {
                        code: 401,
                        error: "Invalid password"
                    })
                    isLogin = false;
                } else {
                    
                    if (!commandData.token) {
                        var token = sha512.sha384(new Date().getMilliseconds().toString())
                        
                        sessionCollection.insert({
                            token: token,
                            time: new Date().toJSON(),
                            clientId: socket.id,
                            address: socket.handshake.address
                        })
                        clientToken = token;
                        socket.emit('login_success', {
                            message: 'Login success',
                            token: token
                        })
                        isLogin = true;
                        console.log("Client " + socket.id + " logged in");
                        updateStatistic();
                        startUpdateStatistic();
                    } else {
                        socket.emit('err', {
                            error: 'Sorry! You\'re already login',
                            code: 406
                        })
                    }
                }
            } else {
                socket.emit('err', {
                    error: 'Sorry! You\'re already login',
                    code: 406
                })
            }

        } else if (commandData.type === 'logout') {
            console.log(command);
            if (commandData.token) {
                sessionCollection.findAndRemove({
                    token: commandData.token
                });
                socket.emit('logout_success', {
                    message: "Logout success",
                    time: new Date().toJSON()
                });
                isLogin = false;
                clearInterval(update);

            } else {
                socket.emit('err', {
                    error: "You must login before logout",
                    code: 400
                })
            }
        } else if (commandData.type === 'control') {
            if (commandData.token) {
                var exists = sessionCollection.findOne({
                    token: commandData.token
                })
                if (exists) {
                    delete commandData.token;
                    delete commandData.type;
                    config.control_config = commandData
                    fs.writeFile('./config.json', JSON.stringify(config), 'utf8', function(err) {
                        if(err) {
                            console.error(err.message)
                        } else {
                            console.log("Configuration saved")
                        }
                    })
                } else {
                    socket.emit('err', {
                        error: "Unauthorization",
                        code: 401
                    })
                }

            } else {
                console.log(121);
                socket.emit('err', {
                    error: "Unauthorization",
                    code: 401
                })
            }
        } else if(commandData.type === 'request') {
            var exists = sessionCollection.findOne({
                token: commandData.token
            })
            console.log(commandData);
            if(exists) {
                socket.emit('control_config', config.control_config)
            }
        } else {
            socket.emit('err', {
                error: "Invalid command",
                code: 400
            })
        }
    })

    socket.on('config', function (config) {
        console.log(config);
        if (config) {
            var configData = JSON.parse(config);

            if (configData.token) {
                var exists = sessionCollection.findOne({
                    token: configData.token
                })
                if (exists) {
                    var value = configData.value;
                    if (value = null || value === undefined || value === NaN) {
                        socket.emit('err', {
                            error: "Missing 'value' field or invalid value",
                            code: 400
                        })
                    } else {
                        if(configData.type !== null || configData.type === undefined) {
                            var dataSend = {
                                type: "config",
                                cmd: configData.type,
                                value: value
                            };
                            console.log(configData.type)

                            if(configData.type === "sensor_state") {
                                isReceiveLightSensor = configData.value === 1
                            }
                            var buff = new Buffer(JSON.stringify(dataSend));
                            udpServer.send(buff, 0, buff.length, udpPort, BOARD_ADDRESS);
                        }
                        
                    }
                } else {
                    socket.emit('err', {
                        error: "Unauthorization",
                        code: 401
                    })
                }

            } else {
                socket.emit('err', {
                    error: "Unauthorization",
                    code: 401
                })
            }
        }

    })

    udpServer.on('message', function (msg, cinfo) {
        if(isLogin && isReceiveLightSensor) {
            var data = JSON.parse(msg);
            console.log(data);
            luminosityCollection.insert({
                time: data.time,
                value: data.value
            });
            socket.emit('light', {
                time: data.time,
                value: data.value
            });
        }
        
    })

    socket.on('signal', function (signal) {
        var signalData = JSON.parse(signal);

        var username = signalData.username;
        var password = signalData.password;

        if (username !== config.credential.username) {
            socket.emit('err', {
                code: 401,
                error: "INVALID_USERNAME"
            });
        } else if (sha512(password) !== config.credential.password) {
            socket.emit('err', {
                code: 401,
                error: "INVALID_PASSWORD"
            });
        } else {
            socket.emit('signal_ok', {
                status: true
            })
            
        }
    })

    socket.on("disconnect", function () {
        console.log("client " + socket.id + " logout and disconnected");
        if (clientToken !== '') {
            sessionCollection.findAndRemove({
                token: clientToken
            })
            clearInterval(update)
        }
    })
});


// handle connect error
io.on('error', function (error) {
    console.error(error);
});

app.get('/', function(req, res) {
    return res.json({
        status: "OK",
        time: new Date().toJSON()
    })
})