const winston = require("winston");
const expressWinston = require("express-winston");

const logFormat = winston.format.combine(winston.format.timestamp(), winston.format.json());

const requestLogger = expressWinston.logger({
  transports: [
    new winston.transports.File({ filename: "logs/request.log" }),
    new winston.transports.Console(),
  ],
  format: logFormat,
  meta: true,
  msg: "HTTP {{req.method}} {{req.url}} - Status: {{res.statusCode}}",
});

const errorLogger = expressWinston.errorLogger({
  transports: [
    new winston.transports.File({ filename: "logs/error.log" }),
    new winston.transports.Console(),
  ],
  format: logFormat,
});

module.exports = {
  requestLogger,
  errorLogger,
};
