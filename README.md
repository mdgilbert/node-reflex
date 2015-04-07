# node-reflex
Node.js server for wiki data cache

<pre>
https:alahele.ischool.uw.edu:8997/api/getEdits
This is the workhorse, delivering a detailed view of page edits given either a starting user or page (or users or pages).

Arguments:
   user: list of user(s) to query, separated by "|"
   userid: list of user id(s) to query, separated by "|"
   page: list of page(s) to query, separated by "|"
   pageid: list of page id(s) to query, separated by "|"
   pageweek: similar to page, but page titles are further separated by comma delimited weeks.
     Example: "pageweek=page1|210,211,225|page2|300,301,310"
     * Either user or page or pageweek is REQUIRED.  If a user is passed in, results will include the top
       pages edited by those users.  If a page is passed in, results will include the top users
       that have edited that page.  In all cases, the output will be the same, including:
       tu_id, tu_name, rc_page_id, tp_title, rc_page_namespace, rc_edits, rc_wikiweek, tug_group

   sd: the start date to query within, of the form YYYYmmdd
   ed: the end date to query within, of the form YYYYmmdd
   sw: the start week to query within, where week 1 is 2001/01/01 (start of wikipedia)
   ew: the end week to query within, where week 1 is 2001/01/01 (start of wikipedia)
     * If both sd/ed and sw/ew are given, week will be used
     * If neither sd/ed or sw/ew are given, range will be 1 year, ending now
   namespace: list of namespaces or namespace IDs, separated by "|". Default is 0 (Article).
     * Example: "Article|Talk|User|User_talk", or "0|1|2|3" are identical
   limit: integer, the number of pages that we want to return.  Default is 1000, <= 0 is no limit.
   subpages: boolean, if present the pages searched will include all subpages,
     ie, searching for edits to WikiProject_Cats will include 'LIKE "WikiProject_Cats%%"'
   projectid: (this one is not fully implemented quite yet) - optional, if present will limit edits to pages within the scope of the given project id

 Output Arguments (how verbose should we be, structure of the output):
   order: "date" or "count". Default is "count" in descending order (most edited page first)
     * Verbosity of rows returned will depend on "group" argument.
   direction: "asc" or "desc", goes with 'order' above. Default is 'desc'.
   group: One of "user", "page", "date", or "assessment" - Default is "user".
     * Ex: "user" returns array of [ user: <name>, edits: # ]
     * Ex: "page" returns array of [ <page_info>, edits: # ] (page_info determined by "return"
     * Ex: "page|user" returns array of [ user: <name>, <page_info>, edits: # ]
     * Ex: "page|user|date" returns [ user: <name>, <page_info>, wikiweek: #, edits: # ]
   assessment: Include assessment information for articles edited, expects bool 0 or 1, default 0
   excludeBots: Boolean, default is 0, will exclude results from users in the bot group

Example to get all the edits to WikiProject Human Computer Interaction's Wikipedia and Wikipedia_Talk pages:

https:alahele.ischool.uw.edu:8997/api/getEdits?page=WikiProject_Human_Computer_Interaction&namespace=4|5&group=page|user|date&sd=20140305

The "group" argument is key here. If you group only by page, only two rows would be returned (one for each of the WikiProject_HCI and corresponding talk pages).  Grouping by page and user would return one row for each of the pages for each user, and grouping by page, user, and date allows the most granular grouping so  you can essentially see every edit to each of the pages given.

===
https:alahele.ischool.uw.edu:8997/api/getReverts
Returns a list of reverts for a given user.

Arguments:
   user: list of user(s) to query, separated by "|"
   sd: the start date to query within, of the format YYYYmmdd
   ed: the end date to query within, of the format YYYYmmdd
   sw: the start week to query within, where week 1 is 2001/01/01 (start of wikipedia)
   ew: the end week to query within, where week 1 is 2001/01/01 (start of wikipedia)
     * If both sd/ed and sw/ew are given, week will be used
     * If neither sd/ed or sw/ew are given, range will be 1 year, ending now
   namespace: list of namespaces or namespace IDs, separated by "|".  Default is 0 (Article).
     * Example: "Article|Talk|User|User_talk" or "0|1|2|3" are identical
   limit: integer, the number of reverts that we want to return. Default is 20.

Example to get all reverts of the user Secretaria between 2008 and 2015:

https:alahele.ischool.uw.edu:8997/api/getReverts?user=Secretaria&sd=20080101&ed=20150101&limit=20

===
https:alahele.ischool.uw.edu:8997/api/getProjects
Return a list of projects matching a filter.  

Arguments:
 title: string that title must match to be returned (case sensitive, can be a substring of title)

If no title argument is given this will return all projects.  Example to get all projects with the substring "human" in them:

https:alahele.ischool.uw.edu:8997/api/getProjects?title=Human

===
https:alahele.ischool.uw.edu:8997/api/getProjectPages
Returns all pages under the scope of a given WikiProject (or projects).

Arguments:
   * project: title of the project
   * pageid: id of the project
   - Note, if project is passed in output keys will be project, if pageid is passed
     in output keys will be the page id (presuming you have the page title if you
     passed in the id)

Example to get all pages under WikiProject Cats:

https:alahele.ischool.uw.edu:8997/api/getProjectPages?project=WikiProject_Cats

===
https:alahele.ischool.uw.edu:8997/api/getActiveProjects
Gets active projects, as determined by the number of edits to pages under the project's scope in the last 30 days.

Arguments:
   group: Determines the granularity of results returned, one or 
     more of "project," "namespace," or "title," separated by "|".
     Default is "project".  Ie, "project|namespace" would returned
     results grouped by project and namespace.
   compress: Specifically to reduce the size of data transferred by
     aggregating numbers before returning to the client.  Currently
     the only option is "project" which will condense grouped data
     so the max number of rows will be the number of projects returned,
     instead of for each project/namespace/title, but still retaining
     aggregate counts for each project (ie, edits by namespace).

Example to get active projects:

https:alahele.ischool.uw.edu:8997/api/getActiveProjects

===
https:alahele.ischool.uw.edu:8997/api/getActiveProjectPages
Gets the most active pages within the scope of the most active projects (determined by revision count in the last 30 days).

Arguments:
   project: a project name (ie, WikiProject_Cats)
   project_id: a project id
     Note: if both project and project_id are given, project_id will be used.  At least one is required
   limit: the number of results to return.  Defaults to 10.

Example to get the most active pages under WikiProject HCI:

https:alahele.ischool.uw.edu:8997/api/getActiveProjectPages?project=WikiProject_Human_Computer_Interaction

===
https:alahele.ischool.uw.edu:8997/api/getProjectMembers
Gets members for any given project between any given timespan.

Arguments:
   project: a project name (ie, WikiProject_Cats)
   pageid: the page id of a project. Can also include multiple page ids, separated by "|", to
     specify a set of project pages (ie, ids for WikiProject_Cats and WikiProject_Cats/Members).
     This will /only/ return users with links on the ids of the passed in pages, not links on all
     project subpages.  If that's the desired behavior pass in the project name.
   sd: the start date to query within, of the format YYYYmmdd
   ed: the end date to query within, of the format YYYYmmdd
     * If neither sd/ed are given, range will be 1 year, ending now

Example to get members for WikiProject HCI for the last year:

https:alahele.ischool.uw.edu:8997/api/getProjectMembers?project=WikiProject_Human_Computer_Interaction

</pre>
