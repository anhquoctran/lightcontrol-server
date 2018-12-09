//init UDP socket server
var dgram = require("dgram");
const udpPort = 12000;
var udpServer = dgram.createSocket("udp4");
udpServer.bind(udpPort);

//init HTTP server and Socket.io module
const httpPort = 13000;
var cookieParser = require("cookie-parser");
const bodyParser = require("body-parser");
var logger = require("morgan");
var session = require("express-session");
var express = require("express");
var qs = require("qs");
var app = express();
var server = require("http").createServer(app);
var io = require("socket.io")(server);

app.use(logger("dev"));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

app.use(cookieParser());

app.use(
	session({
		secret: "quoc96@@",
		resave: false,
		saveUninitialized: true,
		cookie: {
			secure: true
		}
	})
);

app.set("query parser", function (str) {
	return qs.parse(str, {
		decoder: function (s) {
			return decodeURIComponent(s);
		}
	});
});

server.listen(httpPort, function () {
	console.log("Socket IO is running... Port: " + httpPort);
});

// UDP socket server listen
udpServer.on("listening", function () {
	console.log("UDP server is listening... Port: " + udpPort);
});

require('./socket')(io, udpServer);
