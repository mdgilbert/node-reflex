
var localDB = require("./localDB"),
    uw_util = require("./uw_util"),
    url     = require("url"),
    request = require("request");

var db   = localDB.getDB(),
    conn = localDB.getConn();

/* may use this eventually
function fixStrings(obj) {
  for (var i in obj) {
    for (var key in obj[i]) {
      if (obj[i].hasOwnProperty(key)) {
        obj[i][key] = obj[i][key] ? obj[i][key].toString() : "";
      }
    }
  }
  return obj;
}
*/

/*
 * Define functions to handle user requests
 */

// For a set of user(s) or page(s), returns the most frequently edited pages
// Query Arguments (what we're searching for):
//   user: list of user(s) to query, separated by "|"
//   userid: list of user id(s) to query, separated by "|"
//   page: list of page(s) to query, separated by "|"
//   pageid: list of page id(s) to query, separated by "|"
//   pageweek: similar to page, but page titles are further separated by comma delimited weeks.
//     Example: "pageweek=page1|210,211,225|page2|300,301,310"
//     * Either user or page or pageweek is REQUIRED.  If a user is passed in, results will include the top
//       pages edited by those users.  If a page is passed in, results will include the top users
//       that have edited that page.  In all cases, the output will be the same, including:
//       tu_id, tu_name, rc_page_id, tp_title, rc_page_namespace, rc_edits, rc_wikiweek, tug_group
//
//   sd: the start date to query within, of the form YYYYmmdd
//   ed: the end date to query within, of the form YYYYmmdd
//   sw: the start week to query within, where week 1 is 2001/01/01 (start of wikipedia)
//   ew: the end week to query within, where week 1 is 2001/01/01 (start of wikipedia)
//     * If both sd/ed and sw/ew are given, week will be used
//     * If neither sd/ed or sw/ew are given, range will be 1 year, ending now
//   namespace: list of namespaces or namespace IDs, separated by "|". Default is 0 (Article).
//     * Example: "Article|Talk|User|User_talk", or "0|1|2|3" are identical
//   limit: integer, the number of pages that we want to return.  Default is 1000, <= 0 is no limit.
//   subpages: boolean, if present the pages searched will include all subpages,
//     ie, searching for edits to WikiProject_Cats will include 'LIKE "WikiProject_Cats%%"'
//   projectid: optional, if present will limit edits to pages within the scope of the given project id
//
// Output Arguments (how verbose should we be, structure of the output):
//   order: "date" or "count". Default is "count" in descending order (most edited page first)
//     * Verbosity of rows returned will depend on "group" argument.
//   direction: "asc" or "desc", goes with 'order' above. Default is 'desc'.
//   group: One of "user", "page", "date", or "assessment" - Default is "user".
//     * Ex: "user" returns array of [ user: <name>, edits: # ]
//     * Ex: "page" returns array of [ <page_info>, edits: # ] (page_info determined by "return"
//     * Ex: "page|user" returns array of [ user: <name>, <page_info>, edits: # ]
//     * Ex: "page|user|date" returns [ user: <name>, <page_info>, wikiweek: #, edits: # ]
//   assessment: Include assessment information for articles edited, expects bool 0 or 1, default 0
//   excludeBots: Boolean, default is 0, will exclude results from users in the bot group

function getEdits(req, res, next) {
  conn.query("USE " + db);

  var user = req.query.user || 0;
  var userid = req.query.userid || 0;
  var page = req.query.page || 0;
  var subpages = req.query.subpages || 0;
  var pageid = req.query.pageid || 0;
  var pageWeek = req.query.pageweek || 0;
  var assessment = req.query.assessment || 0;
  var excludeBots = req.query.excludeBots || 0;
  var projectid = req.query.projectid || "";

  if (user == 0 && userid == 0 && page == 0 && pageid == 0 && pageWeek == 0 && projectid == "") 
    return uw_util.errorResp(res, 
      "'user', 'userid', 'page', 'pageid', 'projectid', or 'pageweek' argument is required."
    );
  var userQuery = user ? uw_util.buildUserQuery(user) : " 1=1 ";
  var userIdQuery = userid ? uw_util.buildUserQuery(userid, "rc_user_id") : " 1=1 ";
  var pageQuery = page ? uw_util.buildPageQuery(page, undefined, subpages) : " 1=1 ";
  var pageIdQuery = pageid ? uw_util.buildPageIdQuery(pageid) : " 1=1 ";
  var pageWeekQuery = pageWeek ? uw_util.buildPageWeekQuery(pageWeek) : " 1=1 ";

  var sd = req.query.sd || 0;
  var ed = req.query.ed || 0;
  var sw = req.query.sw || 0;
  var ew = req.query.ew || 0;
  var s = e = 0;
  var now = new Date();
  
  // Default end date is today
  ed = ed ? ed : 
    String(now.getFullYear()) + String(uw_util.pad(now.getMonth()+1,2)) + String(uw_util.pad(now.getDate(), 2));

  // Default end date is today
  var def_ed = String(now.getFullYear()) + String(uw_util.pad(now.getMonth()+1,2)) + 
    String(uw_util.pad(now.getDate(), 2));
  // Default start date is 1 year ago
  var def_sd = String(now.getFullYear()-1) + String(uw_util.pad(now.getMonth()+1,2)) + 
    String(uw_util.pad(now.getDate(), 2));

  // Week arguments take priority
  if (sw != 0) s = sw;
  if (sd != 0 && s == 0) sw = s = uw_util.convertDateToWikiWeek(sd);
  if (sw == 0 && sd == 0) sw = s = uw_util.convertDateToWikiWeek(def_sd);
  if (ew != 0) e = ew;
  if (ed != 0 && e == 0) ew = e = uw_util.convertDateToWikiWeek(ed);
  if (ew == 0 && ed == 0) ew = e = uw_util.convertDateToWikiWeek(def_ed);
  if (sw <= 0 || sw > ew) s = e - 55;

  var ns      = req.query.namespace || "0";
  var nsQuery = uw_util.buildNamespaceQuery(ns);
  var limit   = req.query.limit || "1000";
  limit = limit <= 0 ? "" : " LIMIT " + limit;
  var order   = req.query.order || "count";
  var direction = req.query.direction || "desc";
  if (order.toLowerCase() != "count" && order.toLowerCase() != "date") order = "count";
  if (direction.toLowerCase() != "asc" && direction.toLowerCase() != "desc") direction = "desc";
  order = order == "count" ? "rc_edits" : "rc_wikiweek";
  var orderQuery = order + " " + direction;
  var group   = req.query.group || "user";
  var aGroup  = group.split("|");
  var groupQuery = uw_util.buildGroupQuery(group);
  groupQuery = groupQuery ? " GROUP BY " + groupQuery : "";

  // Construct the query
  var sql = "SELECT tu_id, tu_name, rc_page_id, rc_page_namespace, SUM(rc_edits) as 'rc_edits', rc_wikiweek, tp_title, tug_group" + (assessment ? ", pa_assessment " : "") + " FROM reflex_cache JOIN ts_users ON rc_user_id = tu_id JOIN ts_pages ON rc_page_id = tp_id LEFT JOIN ts_users_groups ON tu_id = tug_uid " + (assessment ? " LEFT JOIN project_pages_assessments ON pa_id = rc_page_id " : "") + (projectid ? " JOIN project_pages ON pp_id = rc_page_id " : "") + " WHERE " + nsQuery + " AND " + userQuery + " AND " + userIdQuery + " AND " + pageQuery + " AND " + pageIdQuery + " AND " + pageWeekQuery + " AND rc_wikiweek >= " + s + " AND rc_wikiweek <= " + e + (excludeBots ? " AND (tug_group != 'bot' OR tug_group IS NULL) " : "") + (projectid ? " AND pp_project_id = " + conn.escape(projectid) + " " : "") + groupQuery + " ORDER BY " + orderQuery + " " + limit;
  //console.log("getEdits query (Try 1): " + sql);
  conn.query(sql, function(err, rows, fields) {
    if (err !== null) return uw_util.errorResp(res, err);

    // If we got no results, check to see if user exists
    if (rows.length == 0 && user != 0) {
      var u_sql = "SELECT tu_id, tu_name FROM ts_users WHERE CONVERT(tu_name USING latin1) COLLATE latin1_swedish_ci IN (" + conn.escape(user.split("|").join("','")) + ")";
      console.log("Case-insensitive user query (Try 2): " + u_sql);
      conn.query(u_sql, function(err, rows, fields) {
        if (err !== null) return uw_util.errorResp(res, err);

        if (rows.length == 0) {
          return uw_util.errorResp(res, "No users found with case-insensitive search for " + conn.escape(user.split("|").join(",")));
        } else {
          // Case-insensitive search found user(s).  If the user name returned doesn't match
          // the user we're searching for, redo search with this user.
          var nUser = [];
          for (var i in rows) {
            if (user.split("|").indexOf(rows[i].tu_name.toString()) == -1 && 
                user.toLowerCase().split("|").indexOf( rows[i].tu_name.toString().toLowerCase() ) != -1) {
              // User was found with different case.  Add to new user array and redo search
              nUser.push(rows[i].tu_id);
            }
          }
          if (nUser.length > 0) {
            userIdQuery = uw_util.buildUserQuery(nUser.join("|"), "rc_user_id");
            // Rebuild query and redo search
            sql = "SELECT tu_id, tu_name, rc_page_id, rc_page_namespace, SUM(rc_edits) as 'rc_edits', rc_wikiweek, tp_title, tug_group" + (assessment ? ", pa_assessment " : "") + " FROM reflex_cache JOIN ts_users ON rc_user_id = tu_id JOIN ts_pages ON rc_page_id = tp_id LEFT JOIN ts_users_groups ON tu_id = tug_uid " + (assessment ? " LEFT JOIN project_pages_assessments ON pa_id = rc_page_id " : "") + " WHERE " + nsQuery + " AND " + userIdQuery + " AND " + pageQuery + " AND " + pageIdQuery + " AND " + pageWeekQuery + " AND rc_wikiweek >= " + s + " AND rc_wikiweek <= " + e + (excludeBots ? " AND (tug_group != 'bot' OR tug_group IS NULL) " : "") + groupQuery + " ORDER BY " + orderQuery+ " " + limit;
            console.log("getEdits case-insensitive query (Try 3): " + sql);
            conn.query(sql, function(err, rows, fields) {
              if (err !== null) return uw_util.errorResp(res, err);
              returnGetEditsStruc(rows, aGroup, res);
            });
          } else {
            returnGetEditsStruc([], aGroup, res);
          }
        }
      });
    } else {
      // Structure and return the result
      returnGetEditsStruc(rows, aGroup, res);
    }
  });

}

// Helper function that will, given an array of rows returned by getEdits, will structure
// and return results
function returnGetEditsStruc(rows, aGroup, res) {
  var obj = new Array();
  for (var i in rows) {
    var t = {
      tu_id: rows[i].tu_id,
      tu_name: rows[i].tu_name.toString(),
      rc_edits: rows[i].rc_edits,
    };
    if (aGroup.indexOf('page') >= 0) {
      t["rc_page_id"] = rows[i].rc_page_id;
      t["rc_page_namespace"] = rows[i].rc_page_namespace;
      t["tp_title"] = rows[i].tp_title.toString();
    }
    if (aGroup.indexOf('date') >= 0) t["rc_wikiweek"] = rows[i].rc_wikiweek;
    if (rows[i].rc_edit_group) t["rc_edit_group"] = rows[i].rc_edit_group.toString();
    if (rows[i].tug_group) t["tug_group"] = rows[i].tug_group.toString();
    if ((aGroup.indexOf('page') >= 0 || aGroup.indexOf('assessment') >= 0) && rows[i].pa_assessment)
      t["pa_assessment"] = rows[i].pa_assessment.toString();
    obj.push(t);
  }

  // Return the result (will be an array of objects, ie, rows[0].tu_id would be the user id of the first row.
  res.set({
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*"
  });
  res.end(JSON.stringify({"message": "Fetched " + obj.length + " rows", "errorstatus": "success", "result": obj}));
}

// For a set of user(s), returns a list of reverted edits
// Query Arguments (what we're searching for):
//   user: list of user(s) to query, separated by "|"
//   sd: the start date to query within, of the format YYYYmmdd
//   ed: the end date to query within, of the format YYYYmmdd
//   sw: the start week to query within, where week 1 is 2001/01/01 (start of wikipedia)
//   ew: the end week to query within, where week 1 is 2001/01/01 (start of wikipedia)
//     * If both sd/ed and sw/ew are given, week will be used
//     * If neither sd/ed or sw/ew are given, range will be 1 year, ending now
//   namespace: list of namespaces or namespace IDs, separated by "|".  Default is 0 (Article).
//     * Example: "Article|Talk|User|User_talk" or "0|1|2|3" are identical
//   limit: integer, the number of reverts that we want to return. Default is 20.
//
function getReverts(req, res, next) {
  console.log("Request handler 'getReverts' was called");
  conn.query("USE " + db)

  // Build user query
  var user = req.query.user || 0;
  if (user == 0) return uw_util.errorResp(res, "'user' argument is required");
  var userQuery = uw_util.buildUserQuery(user);

  // Build time query
  var sd = req.query.sd || 0;
  var ed = req.query.ed || 0;
  var sw = req.query.sw || 0;
  var ew = req.query.ew || 0;
  var s = e = 0;
  var now = new Date();

  if (sw != 0 || ew != 0) {
    if (sw <= 0 || sw > ew) s = ew - 55;
    e = ew;
  } else if (sd != 0 || ed != 0) {
    s = uw_util.convertDateToWikiWeek( sd );
    e = uw_util.convertDateToWikiWeek( ed );
  } else {
    // Default range is 1 year ago to now
    s = uw_util.convertDateToWikiWeek(
      String(now.getFullYear()-1) + String(uw_util.pad(now.getMonth()+1,2)) + String(uw_util.pad(now.getDate(), 2))
    );
    e = uw_util.convertDateToWikiWeek(
      String(now.getFullYear()) + String(uw_util.pad(now.getMonth()+1,2)) + String(uw_util.pad(now.getDate(), 2))
    );
  }

  // Build Namespace query
  var ns      = req.query.namespace || "0";
  var nsQuery = uw_util.buildNamespaceQuery(ns, "tp_namespace");
  // Build limit query
  var limit   = req.query.limit || "20";
  limit = limit <= 0 ? "" : " LIMIT " + limit;

  var sql = 'SELECT tu_name AS "user", TIMESTAMPDIFF(WEEK, "20010101000000", pr_revert_timestamp) AS "week", tp_title AS "page_title", tp_namespace AS "page_ns", COUNT(tu_name) AS "count" FROM n_page_reverts JOIN ts_pages ON tp_id = pr_page_id JOIN ts_users ON tu_id = pr_revert_user WHERE ' + nsQuery + ' AND ' + userQuery + ' GROUP BY tu_name, week HAVING week >= ' + s + ' AND week <= ' + e;


  console.log("DEBUG: " + sql);

  conn.query(sql, function(err, rows, fields) {
    if (err !== null) {
      return uw_util.errorResp(res, err);
    }

    // Structure the result
    var obj = new Array();
    for (var i in rows) {
      obj.push({
        user: rows[i].user.toString(),
        week: rows[i].week,
        page_title: rows[i].page_title.toString(),
        page_ns: rows[i].page_ns,
        count: rows[i].count
      });
    }

    // Return the results
    res.set({
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    });
    res.end(JSON.stringify({"message": "Fetched " + obj.length + " rows", "errorstatus": "success", "result": obj}));
  });

}

// Return a list of projects matching a filter
// Input Arguments:
//   * title: string that title must match to be returned (case sensitive, can be a substring of title)
// Output Arguments:
//   * includePageCount: (not implemented) boolean, will include the number of pages for each project if included
//
function getProjects(req, res, next) {
  console.log("Request handler 'getProjects' was called");
  conn.query("USE " + db)

  // Build the query
  var title = req.query.title ? "%%" + req.query.title + "%%" : "";
  var titleQuery = title ? " WHERE p_title LIKE " + conn.escape(title) : '';

  // Mentioned above, not implemented as this increases the time for the query and isn't necessary
  var pc = req.query.includePageCount || 0;
  var pcQuery = pc ? '' : ''; 

  var sql = 'SELECT p_id, p_title, p_created FROM project ' + titleQuery;
  conn.query(sql, function(err, rows, fields) {
    if (err !== null) {
      return uw_util.errorResp(res, err);
    }
    // Structure the result
    var obj = new Array();
    for (var i in rows) {
      obj.push({
        p_id: rows[i].p_id,
        p_title: rows[i].p_title.toString(),
        p_created: rows[i].p_created.toString()
      });
    }

    // Return the results
    res.set({
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    });
    res.end(JSON.stringify({"message": "Fetched " + obj.length + " rows", "errorstatus": "success", "result": obj}));
  });
}

// Return a list of pages for a given project or projects
// Input Arguments (at least one of these must be supplied):
//   * project: title of the project
//   * pageid: id of the project
//   - Note, if project is passed in output keys will be project, if pageid is passed
//     in output keys will be the page id (presuming you have the page title if you
//     passed in the id)
//
// Output Arguments:
//   * NOT IMPLEMENTED - group: if group argument is passed in, page totals will be returned instead of details
//     ie, result set like: [{ project: project1, count: # }, ...], otherwise will return
//     {project1: [{page1: page1id}, ...]}
//   
function getProjectPages(req, res, next) {
  console.log("Request handler 'getProjectPages' was called");
  conn.query("USE " + db)

  // Build the project query
  var project = req.query.project || '';
  var page_id = req.query.pageid  || '';
  if (project == '' && page_id == '') 
    return uw_util.errorResp(res, "Must include either project or pageid argument");
  var page_query = page_id != '' ? page_id : "(SELECT tp_id FROM ts_pages WHERE tp_title = " + conn.escape(project) + " AND tp_namespace = 4)";
  var p_key = page_id != '' ? page_id : project;

  var sql = "SELECT pp_id, pp_project_id, pp_parent_category, tp_title, tp_namespace FROM project_pages JOIN ts_pages ON pp_id = tp_id WHERE pp_project_id = " + page_query;
  conn.query(sql, function(err, rows, fields) {
    if (err !== null) return uw_util.errorResp(res, err);

    // Structure the results
    var obj = {};
    var pages = 0;
    for (var i in rows) {
      pages += 1;
      if (!(p_key in obj)) obj[p_key] = []
      obj[p_key].push({
        pp_id: rows[i].pp_id,
        pp_project_id: rows[i].pp_project_id,
        pp_parent_category: rows[i].pp_parent_category.toString(),
        tp_title: rows[i].tp_title.toString(),
        tp_namespace: rows[i].tp_namespace
      });
    }

    // Return the results
    res.set({
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    });
    res.end(JSON.stringify({"message": "Fetched " + pages + " project pages.", "errorstatus": "success", "result": obj}));
  });
}

// Return a list of projects, sorted by the most edits to project pages
// Arguments:
//   group: Determines the granularity of results returned, one or 
//     more of "project," "namespace," or "title," separated by "|".
//     Default is "project".  Ie, "project|namespace" would returned
//     results grouped by project and namespace.
//   compress: Specifically to reduce the size of data transferred by
//     aggregating numbers before returning to the client.  Currently
//     the only option is "project" which will condense grouped data
//     so the max number of rows will be the number of projects returned,
//     instead of for each project/namespace/title, but still retaining
//     aggregate counts for each project (ie, edits by namespace).
//
function getActiveProjects(req, res, next) {
  conn.query("USE " + db)

  var group = req.query.group || "project";
  var groups = group.split("|");
  var sql_groups = [];
  for (var i in groups) {
    if (groups[i] == "project") { sql_groups.push("pa_project_id"); }
    else if (groups[i] == "namespace") { sql_groups.push("pa_page_namespace"); }
    else if (groups[i] == "title") { sql_groups.push("pa_page_id"); }
  }
  var compress = req.query.compress || "";
  if (compress && compress != "project") compress = "";

  // Get the most recent chunk we've recorded data for first
  var q1 = "SELECT MAX(pa_ww_from) as 'ww' FROM project_activity";
  conn.query(q1, function(err, rows, fields) {
    if (err !== null) {
      return uw_util.errorResp(res, err);
    }

    // Build the query (depending on the group parameter we'll need to join the ts_pages table)
    var q2 = '';
    if (sql_groups.indexOf("pa_page_id") == -1) {
      q2 = "SELECT p_id, p_title, pa_page_namespace, SUM(pa_edits) as 'edits', COUNT(pa_page_id) AS 'pages', p_created FROM project JOIN project_activity ON pa_project_id = p_id WHERE pa_ww_from = " + conn.escape(rows[0].ww) + " GROUP BY " + sql_groups.join(", ") + " ORDER BY edits DESC";
    } else {
      q2 = "SELECT p_id, p_title, tp_id, tp_title, pa_page_namespace, SUM(pa_edits) as 'edits', COUNT(pa_page_id) AS 'pages', p_created FROM project JOIN project_activity ON pa_project_id = p_id JOIN ts_pages ON pa_page_id = tp_id WHERE pa_ww_from = " + conn.escape(rows[0].ww) + " GROUP BY " + sql_groups.join(", ") + " ORDER BY edits DESC";
    }

    // Then get cumulative edits for active projects
    conn.query(q2, function(err, rows, fields) {
      if (err !== null) {
        return uw_util.errorResp(res, err);
      }

      // If compress is "project", condense results for each project
      if (compress == "project") {
        var struc = {};
        for (var i in rows) {
          rows[i].p_title = rows[i].p_title.toString();
          rows[i].p_created = rows[i].p_created.toString();
          if ("tp_title" in rows[i]) rows[i].tp_title = rows[i].tp_title.toString();
          if (! (rows[i].p_id in struc)) {
            struc[rows[i].p_id] = {
              p_title: rows[i].p_title, p_id: rows[i].p_id,
              total_edits: 0, total_pages: 0, p_created: rows[i].p_created,
              total_project_pages: 0,
              0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0,
              7: 0, 8: 0, 9: 0, 10: 0, 11: 0, 12: 0,
              13: 0, 14: 0, 15: 0, 100: 0, 101: 0, 108: 0,
              109: 0, 118: 0, 119: 0, 446: 0, 447: 0, 710: 0,
              711: 0, 828: 0, 829: 0, 2600: 0
            };
          }
          struc[rows[i].p_id][rows[i].pa_page_namespace] += rows[i].edits;
          struc[rows[i].p_id]["total_edits"] += rows[i].edits;
          struc[rows[i].p_id]["total_pages"] += rows[i].pages;
          if (rows[i].pa_page_namespace == 4 || rows[i].pa_page_namespace == 5)
            struc[rows[i].p_id]["total_project_pages"] += rows[i].pages;
        }
        // Convert to array
        var a_struc = [];
        for (var p in struc) {
          a_struc.push(struc[p]);
        }
        rows = a_struc;
      } else {
        // Otherwise just format strings
        for (var i in rows) {
          rows[i].p_title = rows[i].p_title.toString();
          rows[i].p_created = rows[i].p_created.toString();
          if ("tp_title" in rows[i]) rows[i].tp_title = rows[i].tp_title.toString();
        }
      }
      
      res.set({
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      });
      res.end(JSON.stringify({"message": "Fetched " + rows.length + " projects", "errorstatus": "success", "result": rows}));
    });
  });
}

// Given a project, returns a list of the most recent active pages within that project (by revision count)
// Query arguments:
//   project: a project name (ie, WikiProject_Cats)
//   project_id: a project id
//     Note: if both project and project_id are given, project_id will be used.  At least one is required
//   limit: the number of results to return.  Defaults to 10.
function getActiveProjectPages(req, res, next) {
  conn.query("USE " + db)

  var project = req.query.project || 0;
  var project_id = req.query.project_id || 0;
  var limit = req.query.limit || 10;
  if (isNaN(limit)) limit = 10;

  // Get the most recent chunk we've recorded data for first
  var q1 = "SELECT MAX(pa_ww_from) as 'ww' FROM project_activity";
  conn.query(q1, function(err, rows, fields) {
    if (err !== null) {
      return uw_util.errorResp(res, err);
    }
    // Then get the most active pages for this project
    var q2 = "";
    if (project_id != 0) {
      q2 = "SELECT pa_page_id, tp_title, tp_namespace, pa_edits FROM project_activity JOIN ts_pages ON tp_id = pa_page_id WHERE pa_project_id = " + conn.escape(project_id) + " AND pa_ww_from = " + conn.escape(rows[0].ww) + " ORDER BY pa_edits DESC LIMIT " + limit;
    } else if (project != 0) {
      q2 = "SELECT pa_page_id, tp_title, tp_namespace, pa_edits FROM project_activity JOIN ts_pages ON tp_id = pa_page_id JOIN project ON p_id = pa_project_id WHERE p_title = " + conn.escape(project) + " AND pa_ww_from = " + conn.escape(rows[0].ww) + " ORDER BY pa_edits DESC LIMIT " + limit;
    } else {
      return uw_util.errorResp(res, "Either project or project_id is required");
    }
    conn.query(q2, function(err, rows, fields) {
      if (err !== null) {
        return uw_util.errorResp(res, err);
      }
      for (var i in rows) {
        rows[i].tp_title = rows[i].tp_title.toString();
      }
      res.set({
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      });
      res.end(JSON.stringify({"message": "Fetched " + rows.length + " pages", "errorstatus": "success", "result": rows}));
    });
  });
}

// For a given project or project id and timeframe, return a list of members.
// NOTE: This will ultimately aim to replace the getProjectMembers function.
// Query arguments:
//   project: a project name (ie, WikiProject_Cats)
//   pageid: the page id of a project. Can also include multiple page ids, separated by "|", to
//     specify a set of project pages (ie, ids for WikiProject_Cats and WikiProject_Cats/Members).
//     This will /only/ return users with links on the ids of the passed in pages, not links on all
//     project subpages.  If that's the desired behavior pass in the project name.
//   sd: the start date to query within, of the format YYYYmmdd
//   ed: the end date to query within, of the format YYYYmmdd
//     * If neither sd/ed are given, range will be 1 year, ending now
function getProjectUserLinks(req, res, next) {
  console.log("Request handler 'getProjectUserLinks' was called");
  conn.query("USE " + db)

  // Build time query (s and e will be the start and end weeks to search between)
  var sd = req.query.sd || 0;
  var ed = req.query.ed || 0;
  var s = e = 0;
  var now = new Date();
  if (sd != 0 && ed != 0) {
    s = uw_util.convertDateToWikiWeek( sd );
    e = uw_util.convertDateToWikiWeek( ed );
  } else {
    // Default range is 1 year ago to now
    s = uw_util.convertDateToWikiWeek(
      String(now.getFullYear()-1) + String(uw_util.pad(now.getMonth()+1,2)) + String(uw_util.pad(now.getDate(), 2))
    );
    e = uw_util.convertDateToWikiWeek(
      String(now.getFullYear()) + String(uw_util.pad(now.getMonth()+1,2)) + String(uw_util.pad(now.getDate(), 2))
    );
  }

  // Build the query to fetch project members for the given timeframe

  // Structure the results

  // Return the results
      res.set({
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      });
      res.end(JSON.stringify({"message": "TEST SUCCESS", "errorstatus": "success", "result": []}));

}

// For a given project or project id and timeframe, return a list of members
// for that project.
// Query arguments:
//   project: a project name (ie, WikiProject_Cats)
//   pageid: the page id of a project. Can also include multiple page ids, separated by "|", to
//     specify a set of project pages (ie, ids for WikiProject_Cats and WikiProject_Cats/Members).
//     This will /only/ return users with links on the ids of the passed in pages, not links on all
//     project subpages.  If that's the desired behavior pass in the project name.
//   sd: the start date to query within, of the format YYYYmmdd
//   ed: the end date to query within, of the format YYYYmmdd
//     * If neither sd/ed are given, range will be 1 year, ending now
function getProjectMembers(req, res, next) {
  console.log("Request handler 'getProjectMembers' was called");
  conn.query("USE " + db)

  // Build time query (s and e will be the start and end weeks to search between)
  var sd = req.query.sd || 0;
  var ed = req.query.ed || 0;
  var s = e = 0;
  var now = new Date();
  if (sd != 0 && ed != 0) {
    s = uw_util.convertDateToWikiWeek( sd );
    e = uw_util.convertDateToWikiWeek( ed );
  } else {
    // Default range is 1 year ago to now
    s = uw_util.convertDateToWikiWeek(
      String(now.getFullYear()-1) + String(uw_util.pad(now.getMonth()+1,2)) + String(uw_util.pad(now.getDate(), 2))
    );
    e = uw_util.convertDateToWikiWeek(
      String(now.getFullYear()) + String(uw_util.pad(now.getMonth()+1,2)) + String(uw_util.pad(now.getDate(), 2))
    );
  }

  // Build the project query
  var project = req.query.project || '';
  var page_id = req.query.pageid  || '';

  if (project != '') {
    // Get the page ids we're looking for
    var sql = "SELECT tp_id FROM ts_pages WHERE (tp_title LIKE '" + project + "/%' OR tp_title = '" + project + "') AND tp_namespace = 4";
    conn.query(sql, function(err, rows, fields) {
      if (err !== null) {
        return uw_util.errorResp(res, err);
      }
      var pages = new Array();
      for (var i in rows) {
        pages.push(rows[i].tp_id);
      }
      getProjectMembersForPages(res, pages, s, e);
    });
  } else if (page_id != "") {
    getProjectMembersForPages(res, page_id.split("|"), s, e);
  }

}

// Helper function for getProjectMembers.
// res is the response object, pages is an array of page ids, sw and ew are the week ranges
function getProjectMembersForPages(res, pages, sw, ew) {
  // First, build the query to get project members during the timeframe. This will include
  // members who /added/ their links to the pages in the timeframe as well as any member
  // who added their links to the project before that point and never removed them.
  var sql = 'SELECT pm_user_id, pm_user_name, TIMESTAMPDIFF(WEEK, "20010101000000", pm_link_date) AS "week", pm_link_date, pm_link_removed, pm_project_id, pm_page_id, tp_title, tp_namespace FROM project_user_links JOIN ts_pages ON pm_page_id = tp_id WHERE pm_project_id IN (' + pages.join(',') + ') HAVING week <= ' + ew + ' ORDER BY pm_link_date ASC';
  conn.query(sql, function(err, rows, fields) {
    if (err !== null) {
      return uw_util.errorResp(res, err);
    }
    // Go through the results, ignoring the page the link was added to for now.
    // If the link was added, increment count for user. If it was removed, decrement
    // the count.  A user will be a member of the project if the count is >= 1.
    var members = new Object();
    for (var i in rows) {
      var name = rows[i].pm_user_name.toString();
      var pid  = rows[i].pm_page_id;

      // If this is the first time we've seen this user, add as a new member
      if (!(name in members)) members[name] = {};
      if (!(pid in members[name])) members[name][pid] = {
        'tp_title': rows[i].tp_title.toString(),
        'tp_namespace': rows[i].tp_namespace,
        'pm_page_id': rows[i].pm_page_id,
        'pm_user_id': rows[i].pm_user_id,
        'pm_user_name': rows[i].pm_user_name.toString(),
        'link_count': 0,
        'member_since': rows[i].pm_link_date.toString(),
        'member_to': 0,
      };

      if (rows[i].pm_link_removed == 0) {
        // If the user added a link, increment the link count
        members[name][pid].link_count += 1;
      } else {
        // Otherwise, decrement
        members[name][pid].link_count -= 1;
        // And if the user removed their last link from this page (and we're before
        // our start week), remove page from member list.
        // This means that if a user quit and re-joined multiple times in the sw - ew range, we'll
        // only see the start and end membership dates of the first join and last exit. Noting here
        // for clarity - I don't think we'll need that granular of results at this point.
        if (members[name][pid].link_count == 0 && rows[i].week < sw) {
          delete members[name][pid];
        } else if (members[name][pid].link_count == 0) {
          // If link_count is 0 and we're between sw and ew, just update member_to.
          members[name][pid].member_to = rows[i].pm_link_date.toString();
        }
      }
    }

    // Remove members who we've removed all pages from
    for (var n in members) {
      if (Object.keys(members[n]).length == 0) delete members[n];
    }

    // Possible concern, example query of odd user who has more links removed than added,
    // GeorgeMoney in WikiProject Cats
    /* SELECT count(*), TIMESTAMPDIFF(WEEK, "20010101000000", pm_link_date) AS "week" FROM project_user_links JOIN ts_pages ON pm_page_id = tp_id WHERE pm_project_id IN (4766818,22283337,30518361,8205411,7582725,8057168,18614362,26010213,7750343,30810121,7804397,7822211,7601541,9344614,9344599,27570933,26611004,4773974,5143990,5159011,5954230,5159055) and pm_user_id = 640284 and pm_link_removed = 1 HAVING week <= 689 ORDER BY  pm_link_date ASC; */

    // Return the results
    res.set({
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    });
    res.end(JSON.stringify({
      "message": "Fetched " + Object.keys(members).length + " members", 
      "errorstatus": "success", 
      "result": members
    }));
  });
}

// getAnonCoords: Returns anonymous editors for a page along with their geographic coordinates
// Query arguments:
//   page: the page title we're searching for
//   namespace: the ID namespace we're searching for
//   sd: the start date to query within, of the format YYYYmmdd
//   ed: the end date to query within, of the format YYYYmmdd
//     * If neither sd/ed are given, range will be 1 year, ending now
function getAnonCoords(req, res, next) {
  console.log("Request handler 'getAnonCoords' was called");
  conn.query("USE " + db);

  // Ensure we've got a page and namespace
  if (!req.query.page || !req.query.namespace)
    return uw_util.errorResp(res, "'page' and 'namespace' arguments are required.");

  // Build time query (s and e will be the start and end weeks to search between)
  var sd = req.query.sd || 0;
  var ed = req.query.ed || 0;
  var s = e = 0;
  var now = new Date();
  if (sd != 0 && ed != 0) {
    s = uw_util.convertDateToWikiWeek( sd );
    e = uw_util.convertDateToWikiWeek( ed );
  } else {
    // Default range is 1 year ago to now
    s = uw_util.convertDateToWikiWeek(
      String(now.getFullYear()-1) + String(uw_util.pad(now.getMonth()+1,2)) + String(uw_util.pad(now.getDate(), 2))
    );
    e = uw_util.convertDateToWikiWeek(
      String(now.getFullYear()) + String(uw_util.pad(now.getMonth()+1,2)) + String(uw_util.pad(now.getDate(), 2))
    );
  }

  // Build the query
  var sql = "SELECT tu_name, SUM(rc_edits) AS 'edits', rc_wikiweek, gl_lat, gl_long FROM reflex_cache JOIN ts_users ON tu_id = rc_user_id LEFT JOIN ts_users_block ON tu_name = tub_name JOIN geo_location ON tub_block = gl_id WHERE rc_page_id = (SELECT tp_id FROM ts_pages WHERE tp_title = " + conn.escape(req.query.page) + " AND tp_namespace = " + conn.escape(req.query.namespace) + ") AND rc_user_id < 0 AND tub_block IS NOT NULL AND rc_wikiweek >= " + s + " AND rc_wikiweek <= " + e + " GROUP BY tu_name";
  conn.query(sql, function(err, rows, fields) {
    if (err !== null) return uw_util.errorResp(res, err);
    console.log("Found " + rows.length + " anonymous editors");

    for (var i in rows) {
      rows[i].tu_name = rows[i].tu_name.toString();
    }

    // Return the results
    res.set({
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    });
    res.end(JSON.stringify({
      "message": "Fetched " + rows.length + " anonymous editors",
      "errorstatus": "success",
      "result": rows
    }));
  });
}


/*
 * Export our handlers
 */
exports.getEdits              = getEdits;
exports.getReverts            = getReverts;
exports.getProjects           = getProjects;
exports.getProjectPages       = getProjectPages;
exports.getActiveProjects     = getActiveProjects;
exports.getActiveProjectPages = getActiveProjectPages;
exports.getProjectMembers     = getProjectMembers;
exports.getProjectUserLinks   = getProjectUserLinks;
exports.getAnonCoords         = getAnonCoords;

