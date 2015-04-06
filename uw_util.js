
var mysql = require("mysql"); // Used to escape query strings

/*
 * Define namespace lookup objects (so we don't need to do a SQL 'JOIN' on namespace tables)
 */
var ns_lookup = {
  0: 'Article', 1: 'Talk', 2: 'User', 3: 'User_talk', 4: 'Wikipedia', 5: 'Wikipedia_talk',
  6: 'File', 7: 'File_talk', 8: 'Mediawiki', 9: 'Mediawiki_talk', 10: 'Template', 11: 'Template_talk',
  12: 'Help', 13: 'Help_talk', 14: 'Category', 15: 'Category_talk', 100: 'Portal', 101: 'Portal_talk',
  108: 'Book', 109: 'Book_talk'
};
var rev_ns_lookup = {
  'Article': 0, 'Talk': 1, 'User': 2, 'User_talk': 3, 'Wikipedia': 4, 'Project': 4, // Project is a synonym
  'Wikipedia_talk': 5, 'File': 6, 'File_talk': 7, 'Mediawiki': 8, 'Mediawiki_talk': 9, 'Template': 10,
  'Template_talk': 11, 'Help': 12, 'Help_talk': 13, 'Category': 14, 'Category_talk': 15, 'Portal': 100,
  'Portal_talk': 101, 'Book': 108, 'Book_talk': 109
}

/*
 * Define utility functions
 */

function errorResp(res, err) {
  console.log("[ERROR]: " + err);
  res.set({
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*"
  });
  res.write(JSON.stringify({"message": err, "errorstatus": "fail"}));
  res.end();
}

function pad(n, width, z) {
  z = z || '0';
  n = n + '';
  return n.length >= width ? n : new Array(width - n.length + 1).join(z) + n;
}

function getDateStr() {
  var d = new Date();
  var dt =
    String(d.getFullYear()) +
    String(pad(d.getMonth() + 1, 2)) +
    String(pad(d.getDate(), 2)) +
    String(pad(d.getHours(), 2)) +
    String(pad(d.getMinutes(), 2)) +
    String(pad(d.getSeconds(), 2));
  return dt;
}

function convertDateToWikiWeek(time) {
  // Given a date string like '20090822', returns the proper wikiweek (weeks since 2001/01/01)
  var ms = new Date(time.substring(0,4) + '/' + time.substring(4,6) + '/' + time.substring(6,8) + ' 00:00:00').getTime();
  var originMs = new Date('2001/01/01 00:00:00').getTime();
  var msDiff = ms - originMs;
  // milliseconds in a week
  var week = 7 * 24 * 60 * 60 * 1000;
  // weeks in the millisecond range
  return Math.floor(msDiff / week);
}

function convertWikiWeekToDate(ww) {
  // milliseconds in wiki weeks
  var ms = ww * 7 * 24 * 60 * 60 * 1000;
  // Add milliseconds since the epoch to week ms value
  var mil = new Date('2001/01/01 00:00:00').getTime() + ms;
  var date = new Date(mil);

  // Date will be of form YYYYmmdd
  return String(date.getFullYear()) + String(pad( parseInt(date.getMonth()) + 1, 2)) + String(pad(date.getDate(), 2));
}

function parseUrlTitle(url) {
  // Pull the page from the url
  var pat = /wiki\/(.*)/;
  var page = url.match(pat)[1];

  // Pull the namespace (if any) from the page title
  pat = /([^:]*):?(.*)/;
  var m = page.match(pat);
  var obj = {};
  if (m[1] && m[2] && m[1] in rev_ns_lookup) { // A namespace was given and exists
    obj['title'] = m[2];
    obj['ns'] = m[1];
    obj['ns_id'] = rev_ns_lookup[m[1]];
  } else if (m[1] && m[2] && ! (m[1] in rev_ns_lookup)) { // No namespace, colon was in the title
    obj['title'] = m[0];
    obj['ns'] = 'Article';
    obj['ns_id'] = 0;
  } else { // No colon, no namespace was in the title, default to Article, 0 ns id
    obj['title'] = m[1];
    obj['ns'] = 'Article';
    obj['ns_id'] = 0;
  }
  return obj;
}

// Given a namespace name (as defined by WP, ie, Article), returns the namespace id
function getNamespaceName(id) {
  return ns_lookup[id];
}

// Given a namespace id, returns the namespace name as defined by WP
function getNamespaceId(name) {
  return rev_ns_lookup[name];
}

// Given a string like 'Article|Talk|Wikipedia_talk', returns ' rc_page_namespace = 3 OR rc_page_namespace = ...
function buildNamespaceQuery(context, field) {
  if (typeof(field) === 'undefined') field = "rc_page_namespace";

  var aContext = context.split("|");
  var aQuery = new Array();
  for (var i = 0; i < aContext.length; i++) {
    var ns_id = isNaN(aContext[i]) ? rev_ns_lookup[ aContext[i] ] : aContext[i];
    if (ns_id >= 0) {
      aQuery.push(ns_id);
    }
  }
  if (aQuery.length > 0) {
    return field + " IN (" + aQuery.join(",") + ") ";
  } else {
    return "(rc_page_namespace=0)";
  }
}

// Given a string like "User1|User2", returns ' ( tu_name IN ('User1','User2') ) '
function buildUserQuery(user, field) {
  if (typeof(field) === 'undefined') field = "tu_name";

  var sUsers = '"' + user.split("|").join('","') + '"';
  return " " + field + " IN (" + sUsers + ") ";
}

// Given a sting like "Page1|Page2", returns ' ( tp_title = "Page1" OR tp_title = "Page2" ) '
function buildPageQuery(page, field, subpages) {
  if (typeof(field) === 'undefined') field = "tp_title";

  var aPage = page.split("|");
  var aQuery = new Array();
  for (var i = 0; i < aPage.length; i++) {
    if (subpages != 0) {
      aQuery.push(" " + field + " LIKE " + mysql.escape(aPage[i] + "/%") + " OR " + field + "=" + mysql.escape(aPage[i]) + " ");
    } else {
      aQuery.push(" " + field + "=" + mysql.escape(aPage[i]) + " ");
    }
  }
  return "(" + aQuery.join(" OR ") + ")";
}

// Given a string like "<id>|<id>" returns " rc_page_id in (<id>,<id>) "
function buildPageIdQuery(pageId, field) {
  if (typeof(field) === 'undefined') field = "rc_page_id";

  var aPageId = pageId.split("|");
  var san = new Array();
  for (var i = 0; i < aPageId.length; i++) {
    // Make sure we only add numbers
    if (! isNaN(aPageId[i])) san.push(aPageId[i]);
  }

  return " " + field + " IN (" + san.join(",") + ") ";
}

// Given a string like "pageweek=page1|210,211,225|page2|300,301,310", returns
// ' ( (tp_title='page1' AND rc_wikiweek IN (210,211,225)) OR 
//     (tp_title='page2' AND rc_wikiweek IN (300,301,310)) ) '
function buildPageWeekQuery(page) {
  var aPage = page.split("|");
  var p = '';
  var query = new Array();
  for (var i in aPage) {
    if (i % 2 == 1) {
      // Make sure current value is comma delimited list of integers
      var san = new Array();
      var weeks = aPage[i].split(',');
      for (var j in weeks) {
        if (! isNaN(weeks[j])) san.push(weeks[j]);
      }
      query.push( " (tp_title=" + mysql.escape(p) + " AND rc_wikiweek IN (" + san.join(',') + ")) ");
    } else {
      p = aPage[i];
    }
  }
  return "(" + query.join(" OR ") + ")";
}

// Given a string like "user|page" returns " tu_name, rc_page_id "
function buildGroupQuery(group) {
  var aGroup = group.split("|");
  var gStr = '';
  for (var i in aGroup) { 
    //obj[aGroup[i]] = 1; 
    if (aGroup[i] == "user") {
      gStr += "tu_name,";
    } else if (aGroup[i] == "page") {
      gStr += "rc_page_id,";
    } else if (aGroup[i] == "date") {
      gStr += "rc_wikiweek,";
    } else if (aGroup[i] == "assessment") {
      gStr += "pa_assessment,";
    }
  }
  // Strip the last comma from the group string
  gStr = gStr.substring(0, gStr.length-1);
  if (gStr == '') gStr = "tu_name";
  return gStr;
}

// Add a line to a circular log
function log(client, action, ip, sw, ew, context, user, nodes, elapsed, msg) {
  if (typeof msg === 'undefined') {
    msg = '';
  }
  var MAX = 10000; // We'll save 10,000 rows in the db

  var query = "REPLACE INTO reflex_log SET row_id = (SELECT COALESCE(MAX(log_id), 0) % " + MAX + " + 1 FROM reflex_log AS t), message = '" + msg + "', action = '" + action +"', client_ip = '" + ip + "', start_week = " + sw + ", end_week = " + ew + ", context = '" + context + "', user = '" + mysql_real_escape_string(user) + "', nodes = " + nodes + ", elapsed = " + elapsed;
  client.query(query, function(err, results, fields) {
    if (err !== null) {
      console.error("Failed to update log: " + err);
      return false;
    }
  });
}


/*
 * Export utility functions
 */

exports.errorResp             = errorResp;
exports.pad                   = pad;
exports.getDateStr            = getDateStr;
exports.convertDateToWikiWeek = convertDateToWikiWeek;
exports.convertWikiWeekToDate = convertWikiWeekToDate;
exports.parseUrlTitle         = parseUrlTitle;
exports.getNamespaceName      = getNamespaceName;
exports.getNamespaceId        = getNamespaceId;
exports.buildNamespaceQuery   = buildNamespaceQuery;
exports.buildUserQuery        = buildUserQuery;
exports.buildPageQuery        = buildPageQuery;
exports.buildPageIdQuery      = buildPageIdQuery;
exports.buildPageWeekQuery    = buildPageWeekQuery;
exports.buildGroupQuery       = buildGroupQuery;
exports.log                   = log;

