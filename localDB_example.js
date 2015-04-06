/* Provide db connection */
var mysql = require("mysql");

var db   = '[db name]';
var conn = mysql.createConnection({
  //host: '[host name]',
  //port: '[port],
  socketPath: '[path to local socket]',
  user: '[db user]',
  password: '[db password]',
  database: db,
});
conn.connect();

function getConn() {
  return conn;
}

function getDB() {
  return db;
}

exports.getConn = getConn;
exports.getDB   = getDB;

