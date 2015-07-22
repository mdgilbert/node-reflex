
var express         = require("express"),
    https           = require("https"),
    http            = require("http"),
    bodyParser      = require("body-parser"),
    fs              = require("fs"),
    requestHandlers = require("./requestHandlers");

// Setup and cert creation steps from: 
// http://stackoverflow.com/questions/5998694/how-to-create-an-https-server-in-node-js
var options = {
  key: fs.readFileSync('keys/alahele.ischool.uw.edu-key.key'),
  cert: fs.readFileSync('keys/alahele.ischool.uw.edu-cert.pem'),
};

var app = module.exports = express();

var s_port = 8997;
var port   = 8999;

// Create an error with .status. We
// can then use the property in our 
// custom error handler (Connect respects 
// prop as well)
function error(status, msg) {
  var err = new Error(msg);
  err.status = status;
  return err;
}

// bodyParser needs to be above routes
app.use(bodyParser.urlencoded({extended: true, limit: "2000kb"}));

// middleware to ensure Access-Control-Allow-Origin is set
app.use(function(req, res, next) {
  //res.setHeader("Access-Control-Allow-Origin", "https://en.wikipedia.org");
  res.setHeader("Access-Control-Allow-Origin", "http://localhost");
  res.setHeader('Access-Control-Allow-Credentials', true);
  next();
});

//
// Listen
//
var s1 = http.createServer(app).listen(port, function() {
  console.log("http listening on port " + port);
});
var s2 = https.createServer(options, app).listen(s_port, function() {
  console.log("https listening on port " + s_port);
});

//
// Set up socket.io
//
var io = require('socket.io').listen(s2);
var online = {};
io.on("connection", function(socket) {
  // When a page is loaded and the VTE is enabled (initialized, not necessarily drawn)
  socket.on("vte_init", function(obj) {
    // Mark user as online for all actions
    obj.socket = socket.id;
    online[obj.name] = obj;
    io.emit("online", online);
  });
  // When the VTE is drawn
  socket.on("vte_load", function(obj) {
    obj.socket = socket.id;
    online[obj.name] = obj;
    io.emit("online", online);
  });
  // When a project is clicked on from the search box
  socket.on("project_load", function(obj) {
    obj.socket = socket.id;
    online[obj.name] = obj;
    io.emit("online", online);
  });
  // When one of the nav links is clicked (ie, Members, Tasks, Communication, etc)
  socket.on("view", function(obj) {
    obj.socket = socket.id;
    online[obj.name] = obj;
    io.emit("online", online);

  });
  // When one of the modules is updated (ie, Members, Tasks)
  socket.on("update", function(obj) {
    obj.socket = socket.id;
    online[obj.name] = obj;
    io.emit("online", online);

  });
  // Chat message from the communication system
  socket.on("chat", function(obj) {
    obj.socket = socket.id;
    online[obj.name] = obj;
    io.emit("online", online);

    // Save to the db?

    // Broadcast the message
    io.emit("chat", obj);
  });
  // When the vte window is closed
  socket.on("vte_close", function(obj) {
    // Yes, even mark online for the close action (the websocket will still be active)
    obj.socket = socket.id;
    online[obj.name] = obj;
    io.emit("online", online);
    
  });
  // When the connection is broken (ie, tab close, clicked link to load page)
  socket.on('disconnect', function() {
    console.log("Disconnected socket");
    for (var name in online) {
      if (online[name].socket == socket.id) delete online[name];
    }
    io.emit("online", online);
  });
});

//
// Define our routes
//

// For a set of user(s) or page(s), returns the most frequently edited pages 
app.get('/api/getEdits', function(req, res, next) {
  console.log("Routing /api/getEdits");
  requestHandlers.getEdits(req, res, next);
});
// For a set of user(s), returns a list of reverted edits
app.get('/api/getReverts', function(req, res, next) {
  console.log("Routing /api/getReverts");
  requestHandlers.getReverts(req, res, next);
});
// Return a list of WikiProjects
app.get('/api/getProjects', function(req, res, next) {
  console.log("Routing /api/getProjects");
  requestHandlers.getProjects(req, res, next);
});
// For a project or list of project page ids, get members within a given timeframe
app.get('/api/getProjectMembers', function(req, res, next) {
  console.log("Routing /api/getProjectMembers");
  requestHandlers.getProjectMembers(req, res, next);
});
app.get('/api/getProjectUserLinks', function(req, res, next) {
  console.log("Routing /api/getProjectUserLinks");
  requestHandlers.getProjectUserLinks(req, res, next);
});
app.get('/api/getProjectPages', function(req, res, next) {
  console.log("Routing /api/getProjectPages");
  requestHandlers.getProjectPages(req, res, next);
});
app.get('/api/getActiveProjects', function(req, res, next) {
  console.log("Routing /api/getActiveProjects");
  requestHandlers.getActiveProjects(req, res, next);
});
app.get('/api/getActiveProjectPages', function(req, res, next) {
  console.log("Routing /api/getActiveProjectPages");
  requestHandlers.getActiveProjectPages(req, res, next);
});
// For a given page, request anonymous editors and their geographic coordinates
app.get('/api/getAnonCoords', function(req, res, next) {
  console.log("Routing /api/getAnonCoords");
  requestHandlers.getAnonCoords(req, res, next);
});


//
// Define our middleware
//

// Serve static files
app.use("/static", express.static(__dirname + "/static"));

// middleware with an arity of 4 are considered
// error handling middleware. When you next(err)
// it will be passed through the defined middleware
// in order, but ONLY those with an arity of 4, ignoring
// regular middleware.
app.use(function(err, req, res, next){
  // whatever you want here, feel free to populate
  // properties on `err` to treat it differently in here.
  res.send(err.status || 500, { error: err.message });
});

// our custom JSON 404 middleware. Since it's placed last
// it will be the last middleware called, if all others
// invoke next() and do not respond.
app.use(function(req, res){
  //res.send(404, { error: "Unknown path." });
  res.status(404).send({ error: "Unknown path." });
});



