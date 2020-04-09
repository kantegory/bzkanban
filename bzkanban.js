/* jshint browser: true, devel: true */
/* global async, linkifyHtml, timeago, CryptoJS, Map, Set */
"use strict";

// Override these by passing in an object with any of these key/value pairs into the initBzkanban function on startup.
var bzOptions = {
  //    siteUrl: "https://bugzilla.mozilla.org",
  order: "priority,bug_severity,assigned_to",
  allowEditBugs: true,
  addCommentOnChange: true,
  loadComments: false,
  checkForUpdates: true,
  autoRefresh: false,
  domElement: "#bzkanban",
  backlogDefaultStatus: "CONFIRMED",
  requiresResolution: { "RESOLVED": true }
};

// "Private" global variables. Do not touch.
var bzProduct = "";
var bzProductMilestone = "";
var bzComponent = "";
var bzPriority = "";
var bzAssignedTo = "";
var bzUserFullName = "";
var bzProductHasUnconfirmed = false;
var bzBoardLoadTime = "";
var bzRestGetBugsUrl = "";
var bzRestGetBacklogUrl = "";
var bzAssignees = new Map();
var bzProductComponents;
var bzProductVersions;
var bzProductResolutions;
var bzProductPriorities;
var bzProductSeverities;
var bzDefaultPriority;
var bzDefaultSeverity;
var bzDefaultMilestone;
var bzAuthObject;

function initBzkanban(options) {
  bzOptions = Object.assign(bzOptions, options); // Merge custom options into defaults.
  loadParams();
  async.parallel([
        initNav, 
        initBoard
  ],
  function(err, results) {
    console.log("bzkanban initialized!");
  });
}

function loadParams() {
  var product = getURLParameter("product");
  if (product !== null) {
    bzProduct = product;
  }

  var milestone = getURLParameter("milestone");
  if (milestone !== null) {
    bzProductMilestone = milestone;
  }

  var assignee = getURLParameter("assignee");
  if (assignee !== null) {
    bzAssignedTo = assignee;
  }

  // Allow the Bugzilla site URL to be overriden. Useful for testing.
  // For most permanent deployments just change the hardcodecoded bzSiteUrl.
  var site = getURLParameter("site");
  if (site !== null) {
    bzOptions.siteUrl = site;
  }

  // Loading comments is expensive becase it's one extra request per bug.
  // Causing some Bugzilla servers to respond with "too many requests" errors.
  var comments = getURLParameter("comments");
  if (comments !== null) {
    bzOptions.loadComments = isTrue(comments);
  }

  var autorefresh = getURLParameter("autorefresh");
  if (autorefresh !== null) {
    bzOptions.autoRefresh = isTrue(autorefresh);
  }

  bzAuthObject = JSON.parse(localStorage.getItem(bzOptions.siteUrl));
}

function initNav(callback) {
  var nav = document.createElement("div");
  nav.id = "nav";
  document.querySelector(bzOptions.domElement).appendChild(nav);

  nav.appendChild(createQueryFields());

  var spring = document.createElement("span");
  spring.className = "spring";
  nav.appendChild(spring);

  nav.appendChild(createActions());

  async.parallel([
    loadName,
    loadProductsList,
    loadMilestonesList
  ],
  function(err, results) {
      console.log("Nav initialized!");
      callback();
  });
}

function initBoard(callbackInitBoard) {
  var board = document.createElement("div");
  board.id = "board";
  document.querySelector(bzOptions.domElement).appendChild(board);

  async.parallel(
    [
      loadColumnsAndCards,
      loadProductInfo,
      loadResolutions,
      loadPriorities,
      loadSeverities,
      loadDefaultPrioritySeverityFields
    ],
    function(err, results) {
      console.log("Board initialized!");
      callbackInitBoard();
      fetchAllUserBugs("assigned_to");
    }
  );
}

function createQueryFields() {
  var query = document.createElement("span");
  query.id = "query";

  var product = document.createElement("span");

  var productIcon = document.createElement("i");
  productIcon.className = "fa fa-archive";
  productIcon.title = "Product";

  var productList = document.createElement("select");
  productList.className = "custom-select";
  productList.id = "textProduct";
  productList.name = "product";
  productList.disabled = "true"; // until content is loaded

  // When the user changes the Product drop down
  productList.addEventListener("change", function () {
    bzProduct = document.getElementById("textProduct").value;

    // Disable Milestones until it's refreshed
    document.getElementById("textMilestone").disabled = true;

    // Clear affected state.
    bzProductMilestone = "";
    bzAssignedTo = "";
    showSpinner();
    hideBacklog();
    clearAssigneesList();
    clearCards();
    updateAddressBar();
    hideBacklogButton();
    hideNewBugButton();
    hideNotification();
    async.parallel([loadMilestonesList, loadProductInfo], function (
      err,
      result
    ) {
      hideSpinner();
    });
  });

  var milestone = document.createElement("span");

  var milestoneIcon = document.createElement("i");
  milestoneIcon.className = "fa fa-flag";
  milestoneIcon.title = "Milestone";

  var milestoneList = document.createElement("select");
  milestoneList.id = "textMilestone";
  milestoneList.name = "milestone";
  milestoneList.disabled = "true"; // until content is loaded

  // When the user changes the Milestone drop down
  milestoneList.addEventListener("change", function () {
    bzProductMilestone = document.getElementById("textMilestone").value;

    // Hot load the board without a form submit.
    loadBoard();
  });

  var assignee = document.createElement("span");

  var assigneeIcon = document.createElement("i");
  assigneeIcon.className = "fa fa-user";
  assigneeIcon.title = "Assignee";

  var assigneeList = document.createElement("select");
  assigneeList.id = "textAssignee";
  assigneeList.name = "assignee";
  assigneeList.disabled = "true"; // until content is loaded

  // When the user changes the Assignee drop down
  assigneeList.addEventListener("change", function () {
    bzAssignedTo = document.getElementById("textAssignee").value;
    updateAddressBar();
    var name = bzAssignees.get(bzAssignedTo).real_name;
    filterByAssignee(name);
  });

  var filter = document.createElement("span");

  var filterIcon = document.createElement("i");
  filterIcon.className = "fa fa-search";
  filterIcon.title = "Filter";

  var filterText = document.createElement("input");
  filterText.id = "textFilter";
  filterText.name = "textFilter";
  filterText.placeholder = "Filter";
  filterText.addEventListener("keyup", function () {
    debounce(filterByString(document.getElementById("textFilter").value), 500);
  });

  product.appendChild(productIcon);
  product.appendChild(productList);
  milestone.appendChild(milestoneIcon);
  milestone.appendChild(milestoneList);
  assignee.appendChild(assigneeIcon);
  assignee.appendChild(assigneeList);
  filter.appendChild(filterIcon);
  filter.appendChild(filterText);

  query.appendChild(product);
  query.appendChild(milestone);
  query.appendChild(assignee);
  query.appendChild(filter);

  return query;
}

function createBacklogButton() {
  var backlogShowButton = document.createElement("button");
  backlogShowButton.id = "btnShowBacklog";
  backlogShowButton.className = "btnStyle";
  backlogShowButton.innerText = "Show Backlog";
  backlogShowButton.style.display = "none";
  backlogShowButton.addEventListener("click", function () {
    if (!isBacklogVisible()) {
      showBacklog();
    } else {
      hideBacklog();
    }
  });

  return backlogShowButton;
}

function createActions() {
  var actions = document.createElement("span");
  actions.id = "actions";

  var newbug = document.createElement("button");
  newbug.id = "btnCreate";
  newbug.className = "btnStyle";
  newbug.innerText = "New Bug";
  newbug.style.display = "none";
  newbug.addEventListener("click", function () {
    if (isLoggedIn()) {
      showNewBugModal();
    } else {
      // Open Bugzilla page
      window.open(
        bzOptions.siteUrl +
          "/enter_bug.cgi?product=" +
          bzProduct +
          "&target_milestone=" +
          bzProductMilestone
      );
    }
  });

  var whoami = document.createElement("span");
  whoami.id = "whoami";
  whoami.style.display = "none";

  var login = document.createElement("button");
  login.id = "btnSignIn";
  login.className = "btnStyle";
  login.innerText = "Login";
  login.addEventListener("click", function () {
    showLoginModal();
  });

  var showMyBugs = document.createElement("button");
  showMyBugs.id = "showMyBugs";
  showMyBugs.className = "btnStyle";
  showMyBugs.innerText = "My bugs";
  showMyBugs.addEventListener("click", function () {
    fetchAllUserBugs("assigned_to");
  });

  var showPupilBugs = document.createElement("button");
  showPupilBugs.id = "showPupilBugs";
  showPupilBugs.className = "btnStyle";
  showPupilBugs.innerText = "Bugs I'm interested in";
  showPupilBugs.addEventListener("click", function () {
    fetchAllUserBugs("qa_contact");
  });

  var bell = document.createElement("i");
  bell.id = "notification";
  bell.className = "fa fa-bell";

  actions.appendChild(createBacklogButton());
  actions.appendChild(newbug);
  actions.appendChild(showMyBugs);
  actions.appendChild(showPupilBugs);
  actions.appendChild(whoami);
  actions.appendChild(login);
  actions.appendChild(bell);

  return actions;
}

function showLoginModal() {
  var loginModal = createModal("loginModal");
  var header = loginModal.querySelector(".modal-header");
  var body = loginModal.querySelector(".modal-body");
  var footer = loginModal.querySelector(".modal-footer");

  header.appendChild(document.createTextNode("Please log in"));

  var usernameLabel = document.createElement("label");
  usernameLabel.innerText = "Username";

  var username = document.createElement("input");
  username.id = "textUsername";
  username.type = "text";
  username.required = true;

  usernameLabel.appendChild(username);

  var passwordLabel = document.createElement("label");
  passwordLabel.innerText = "Password";

  var password = document.createElement("input");
  password.id = "textPassword";
  password.type = "password";
  password.required = true;

  // When the user presses enter, in the Login password form
  password.addEventListener("keyup", function (event) {
    event.preventDefault();
    if (event.keyCode == 13) {
      document.getElementById("btnAuthSubmit").click();
    }
  });

  passwordLabel.appendChild(password);

  var submit = document.createElement("button");
  submit.id = "btnAuthSubmit";
  submit.innerText = "Submit";
  submit.type = "button";
  submit.addEventListener("click", function () {
    var user = document.getElementById("textUsername").value;
    var password = document.getElementById("textPassword").value;
    doAuth(user, password);
    hideModal();
  });

  body.appendChild(usernameLabel);
  body.appendChild(passwordLabel);
  footer.appendChild(submit);

  document.querySelector(bzOptions.domElement).appendChild(loginModal);
}

function loginModalVisible() {
    return document.querySelector(bzOptions.domElement).querySelector("#loginModal") != null;
}

function loadBoard(callbackLoadBoard, state) {
  console.log("state in loadBoard", state);
  console.log("callbackLoadBoard", callbackLoadBoard)
  if (bzProduct === "" || bzProductMilestone === "") {
    console.error("product is none")
    if (callbackLoadBoard !== undefined) {
      console.log("callback isnot undefined, state is", state)
      if (state !== undefined) {
	console.log("state isnot undefined");
        return callbackLoadBoard(state);
      }
      return callbackLoadBoard();
    } else {
      return;
    }
  }

  showSpinner();
  clearAssigneesList();
  clearCards();
  hideNotification();
  showNewBugButton();
  if (bzProductMilestone === "---") {
    hideBacklog();
    hideBacklogButton();
  } else {
    showBacklogButton();
  }
  updateAddressBar();

  async.series(
    [
      loadBugs,
      function (callback) {
        if (isBacklogVisible()) {
          loadBacklogCards(callback);
        } else {
          callback();
        }
      },
      function (callback) {
        // Needed for Bugzilla 6 because email not returned in bug info anymore.
        if (isLoggedIn()) {
          loadEmailAddress(callback);
        } else {
          callback();
        }
      }
    ],
    function (err, results) {
      hideSpinner();
      console.log("Board loaded!");
      if (callbackLoadBoard !== undefined) {
        callbackLoadBoard();
      }
    }
  );
}

function loadBugs(callback) {
  bzBoardLoadTime = new Date().toISOString();

  bzRestGetBugsUrl = "/rest.cgi/bug?product=" + bzProduct;
  bzRestGetBugsUrl += "&include_fields=summary,status,resolution,id,severity,priority,assigned_to,last_updated,deadline";
  bzRestGetBugsUrl += "&order=" + bzOptions.order;
  bzRestGetBugsUrl += "&target_milestone=" + bzProductMilestone;
  bzRestGetBugsUrl += "&component=" + bzComponent;
  bzRestGetBugsUrl += "&priority=" + bzPriority;

  httpGet(bzRestGetBugsUrl, function (response) {
    var bugs = response.bugs;

    bugs.forEach(function (bug) {
      var card = createCard(bug);
      var status = bug.status.replace(/ /g, "\\ ");
      document.querySelector("#" + status + " .cards").appendChild(card);
    });

    showColumnCounts();
    loadAssigneesList();
    if (bzAssignedTo !== "") {
      var assignee = bzAssignees.get(bzAssignedTo);
      if (assignee === undefined) {
        // This may happen when changing milestones if assignee had been selected but has no cards here.
        // TODO: hide all cards?
        console.log(
          "No cards found assigned to " + bzAssignedTo + ". Showing all."
        );
      } else {
        filterByAssignee(assignee.real_name);
      }
    }
    scheduleCheckForUpdates();

    console.log("Loaded bugs: " + bugs.length);
    callback();
  });
}

function loadProductsList(callback) {
  httpGet("/rest.cgi/product?type=enterable&include_fields=name", function (
    response
  ) {
    document.getElementById("textProduct").disabled = false;
    var products = response.products;
    products.sort(function (a, b) {
      return a.name.localeCompare(b.name);
    });
    var hiddenOption = document.createElement("option");
    hiddenOption.value = "";
    hiddenOption.setAttribute("disabled", "");
    hiddenOption.setAttribute("selected", "");
    hiddenOption.text = "Выберите раздел:";
    document.getElementById("textProduct").appendChild(hiddenOption);
    products.forEach(function (product) {
      var option = document.createElement("option");
      option.value = product.name;
      option.text = product.name;
      document.getElementById("textProduct").appendChild(option);
    });

    // select it in list.
    document.getElementById("textProduct").value = bzProduct;

    callback();
  });
}

function loadMilestonesList(callback) {
  if (bzProduct === "") {
    return callback();
  }

  clearMilestonesList();
  httpGet(
    "/rest.cgi/product?names=" + bzProduct + "&include_fields=milestones",
    function (response) {
      document.getElementById("textMilestone").disabled = false;
      var milestones = response.products[0].milestones;
      var hiddenOption = document.createElement("option");
      hiddenOption.value = "";
      hiddenOption.setAttribute("disabled", "");
      hiddenOption.setAttribute("selected", "");
      hiddenOption.text = "Выберите версию:";
      document.getElementById("textMilestone").appendChild(hiddenOption);
      milestones.forEach(function (milestone) {
        var option = document.createElement("option");
        option.value = milestone.name;
        option.text = milestone.name;
        document.getElementById("textMilestone").appendChild(option);
      });

      // select it in list.
      document.getElementById("textMilestone").value = bzProductMilestone;

      callback();
    }
  );
}

function loadAssigneesList() {
  // HACK add phony user so that we can show all users
  bzAssignees.set("", { real_name: "ALL", email: "" });

  var sorted = Array.from(bzAssignees.values()).sort(function(a, b) {
    return a.real_name.localeCompare(b.real_name);
  });

  var elem = document.getElementById("textAssignee");
  var hiddenOption = document.createElement("option");
  hiddenOption.value = "";
  hiddenOption.setAttribute("disabled", "");
  hiddenOption.setAttribute("selected", "");
  hiddenOption.text = "Выберите сотрудника:";
  document.getElementById("textAssignee").appendChild(hiddenOption);
  sorted.forEach(function (assignee) {
    var option = document.createElement("option");
    option.value = assignee.email;
    option.text = assignee.real_name;
    elem.appendChild(option);
  });
  // select it in list.
  document.getElementById("textAssignee").value = bzAssignedTo;

  elem.removeAttribute("disabled");
}

function loadProductInfo(callback) {
  if (bzProduct === "") {
    return callback();
  }

  async.parallel(
    [
      loadUnconfirmedVisibility,
      loadDefaultMilestone,
      loadComponentsList,
      loadVersionsList
    ],
    function (err, results) {
      callback();
    }
  );
}

function loadColumnsAndCards(callback) {
  async.series([loadColumns, loadBoard], function (err, results) {
    callback();
  });
}

function loadColumns(callback) {
   httpGet("/rest.cgi/field/bug/status/values", function(response) {
    // Always add a backlog as first column
    var backlog = addBoardColumn("BACKLOG");
    hideBacklog();

    var statuses = response.values;
    statuses.forEach(function(status) {
      addBoardColumn(status);
    });

    callback();
  });
}

function loadComments(bug) {
  httpGet("/rest.cgi/bug/" + bug.id + "/comment?include_fields=id", function (
    response
  ) {
    var card = getCardElement(bug.id);
    var commentCount = response.bugs[bug.id].comments.length - 1;
    if (commentCount > 1) {
      var commentElement = card.querySelector(".comment-count");
      commentElement.style.display = null; // unhide it

      var icon = document.createElement("i");
      icon.className = "fa fa-comment-o fa-sm";

      commentElement.appendChild(icon);
      commentElement.appendChild(document.createTextNode(commentCount));
    }
  });
}

function loadName(callback) {
  if (!isLoggedIn()) {
    return callback();
  }
  console.log("this is bzAuthObject", bzAuthObject);

  httpGet("/rest.cgi/user/" + bzAuthObject.userID, function (response) {
    bzUserFullName = response.users[0].real_name;
    if (bzUserFullName !== null) {
      var el = document.getElementById("whoami");
      el.textContent = bzUserFullName;
      el.style.display = null; // unhide it
      hideSignInButton();
    }
    callback();
  });
}

function loadResolutions(callback) {
  bzProductResolutions = new Set();
  httpGet("/rest.cgi/field/bug/resolution", function (response) {
    var arrayResolutions = response.fields;
    arrayResolutions[0].values.forEach(function (resolution) {
      var resolutionName = resolution.name;
      if (resolutionName === "") {
        return;
      }
      bzProductResolutions.add(resolutionName);
    });
    callback();
  });
}

function loadPriorities(callback) {
  bzProductPriorities = new Set();
  httpGet("/rest.cgi/field/bug/priority", function (response) {
    var arrayPriorities = response.fields;
    arrayPriorities[0].values.forEach(function (priority) {
      var priorityName = priority.name;
      if (priorityName === "") {
        return;
      }
      bzProductPriorities.add(priorityName);
    });
    callback();
  });
}

function loadSeverities(callback) {
  bzProductSeverities = new Set();
  httpGet("/rest.cgi/field/bug/bug_severity", function (response) {
    var arraySeverities = response.fields;
    arraySeverities[0].values.forEach(function (severity) {
      var severityName = severity.name;
      if (severityName === "") {
        return;
      }
      bzProductSeverities.add(severityName);
    });
    callback();
  });
}

function loadComponentsList(callback) {
  bzProductComponents = new Set();
  httpGet(
    "/rest.cgi/product/" +
      bzProduct +
      "?type=enterable&include_fields=components",
    function (response) {
      var components = response.products[0].components;
      components.sort(function (a, b) {
        return a.name.localeCompare(b.name);
      });
      components.forEach(function (component) {
        if (!component.is_active) {
          return;
        }
        bzProductComponents.add(component.name);
      });
      callback();
    }
  );
}

function loadVersionsList(callback) {
  bzProductVersions = new Set();
  httpGet(
    "/rest.cgi/product/" +
      bzProduct +
      "?type=enterable&include_fields=versions",
    function (response) {
      var versions = response.products[0].versions;
      versions.sort(function (a, b) {
        return a.name.localeCompare(b.name);
      });
      versions.forEach(function (version) {
        if (!version.is_active) {
          return;
        }
        bzProductVersions.add(version.name);
      });
      callback();
    }
  );
}

function loadCheckForUpdates() {
  if (bzBoardLoadTime === "") {
    bzOptions.checkForUpdates = false;
    return;
  }
  httpGet(bzRestGetBugsUrl + "&last_change_time=" + bzBoardLoadTime, function (
    response
  ) {
    if (response.bugs.length > 0) {
      if (bzOptions.autoRefresh) {
        loadBoard();
      } else {
        showNotification(
          response.bugs.length +
            " bug(s) have been updated externally. Hit refresh!"
        );
      }
    }

    if (bzOptions.checkForUpdates) {
      // Repeat.
      scheduleCheckForUpdates();
    }
  });
}

function loadDefaultPrioritySeverityFields(callback) {
  httpGet("/rest.cgi/parameters", function (response) {
    // HACK: The BMO site returns "no such method" response for some reason.
    if (!response.error) {
      bzDefaultPriority = response.parameters.defaultpriority;
      bzDefaultSeverity = response.parameters.defaultseverity;
    }
    callback();
  });
}

function loadUnconfirmedVisibility(callback) {
  httpGet(
    "/rest.cgi/product/" + bzProduct + "?include_fields=has_unconfirmed",
    function (response) {
      bzProductHasUnconfirmed = response.products[0].has_unconfirmed;
      updateUnconfirmedColumnVisibilty();
      callback();
    }
  );
}

function loadDefaultMilestone(callback) {
  httpGet(
    "/rest.cgi/product/" +
      bzProduct +
      "?type=enterable&include_fields=default_milestone",
    function (response) {
      bzDefaultMilestone = response.products[0].default_milestone;
      callback();
    }
  );
}

function addBoardColumn(status) {
  var div = document.createElement("div");
  div.className = "board-column";
  div.id = status;
  if (isLoggedIn() && bzOptions.allowEditBugs) {
    div.addEventListener("drag", dragCardStart);
    div.addEventListener("dragend", dragCardEnd);
    div.addEventListener("dragover", dragCardOver);
    div.addEventListener("drop", dropCard);
    div.addEventListener("dragenter", dragCardEnter);
    div.addEventListener("dragleave", dragCardLeave);
  }

  var title = document.createElement("div");
  title.className = "board-column-title";
  title.innerHTML = status;
  div.appendChild(title);

  var content = document.createElement("div");
  content.className = "board-column-content";
  div.appendChild(content);

  var cards = document.createElement("div");
  cards.className = "cards";
  content.appendChild(cards);

  document.getElementById("board").appendChild(div);

  return div;
}

function createCard(bug) {
  var card = document.createElement("div");
  card.className = "card";
  card.id = bug.id;
  card.dataset.bugId = bug.id;
  card.dataset.bugStatus = bug.status;
  card.dataset.bugPriority = bug.priority;
  card.dataset.bugSeverity = bug.severity;
  card.dataset.bugResolution = bug.resolution;

  if (isLoggedIn() && bzOptions.allowEditBugs) {
    card.onclick = function () {
      var bugObject = {};
      bugObject.id = bug.id;
      bugObject.status = bug.status;
      bugObject.priority = bug.priority;
      bugObject.severity = bug.severity;
      bugObject.resolution = bug.resolution;
      showBugModal(bugObject, bugObject);
    };
  } else {
    card.onclick = function () {
      var link = bzOptions.siteUrl + "/show_bug.cgi?id=" + bug.id;
      window.open(link, "_blank");
    };
  }

  var summary = document.createElement("div");
  summary.appendChild(document.createTextNode(bug.summary)); // so that we get HTML string escaping for free
  summary.className = "card-summary";

  var meta = document.createElement("div");
  meta.className = "card-meta";

  var assignee = document.createElement("span");
  assignee.title = "Assignee";
  assignee.className = "assignee";
  assignee.dataset.assigneeName = bug.assigned_to_detail.name;

  var fullname = document.createElement("span");
  fullname.className = "fullname";
  fullname.innerHTML = bug.assigned_to_detail.real_name;

  var picture = document.createElement("img");
  picture.className = "gravatar";
  picture.style.display = "none";
  // Email field removed in Bugzilla 6.
  if (bug.assigned_to_detail.email !== undefined) {
    picture.src = getGravatarImgSrc(bug.assigned_to_detail.email);
    picture.style.display = "block";
  }

  var icons = document.createElement("span");
  icons.className = "badges";

  var bugnumber = document.createElement("span");
  bugnumber.className = "badge bug-number";
  bugnumber.appendChild(createBugNumberElement(bug.id));

  var comment = document.createElement("span");
  comment.className = "badge comment-count";
  comment.style.display = "none";

  var deadline = createDeadlineElement(bug.deadline);

  var priority = document.createElement("span");
  priority.className = "badge priority";
  priority.title = "Priority";
  priority.dataset.priority = bug.priority;
  priority.appendChild(document.createTextNode(bug.priority));

  var severity = document.createElement("span");
  severity.className = "badge severity";
  severity.title = "Severity";
  severity.dataset.severity = bug.severity;
  severity.appendChild(document.createTextNode(bug.severity));

  card.appendChild(summary);
  card.appendChild(meta);
  meta.appendChild(icons);
  icons.appendChild(bugnumber);
  icons.appendChild(priority);
  icons.appendChild(severity);
  icons.appendChild(comment);
  icons.appendChild(deadline);
  assignee.appendChild(fullname);
  assignee.appendChild(picture);
  meta.appendChild(assignee);

  if (isLoggedIn() && bzOptions.allowEditBugs) {
    card.draggable = "true";
    card.addEventListener("dragstart", dragCard);
  }

  if (bzOptions.loadComments) {
    loadComments(bug);
  }

  if (bug.assigned_to_detail.email === undefined) {
    // HACK: The bz username is often the email address if one isn't set.
    bug.assigned_to_detail.email = bug.assigned_to_detail.name;
  }
  bzAssignees.set(bug.assigned_to_detail.email, bug.assigned_to_detail); // save for later

  return card;
}

function createDeadlineElement(deadline) {
  var deadlineElement = document.createElement("span");
  deadlineElement.className = "badge deadline";

  if (deadline === undefined || deadline === null) {
    deadlineElement.style.display = "none";
    return deadlineElement;
  }

  var month = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sept",
    "Oct",
    "Nov",
    "Dec"
  ];
  var todayDate = Date.now();
  var cardDate = new Date();
  var dateArray = deadline.split("-");
  cardDate.setFullYear(dateArray[0], dateArray[1] - 1, dateArray[2]);

  var icon = document.createElement("i");
  icon.className = "fa fa-calendar-o fa-sm";

  var dateText = document.createTextNode(
    cardDate.getDate() +
      " " +
      month[cardDate.getMonth()] +
      " " +
      cardDate.getFullYear()
  );

  deadlineElement.appendChild(icon);
  deadlineElement.appendChild(dateText);

  if (cardDate > todayDate) {
    var daysDifference = Math.round(
      (todayDate - cardDate) / (1000 * 60 * 60 * 24)
    );
    if (daysDifference >= -7 && daysDifference <= 0) {
      // One week out
      deadlineElement.style.color = "orange";
    }
  } else {
    // Has expired
    deadlineElement.style.color = "red";
  }

  return deadlineElement;
}

function removeBoard() {
  document.querySelector("#board").remove();
}

function clearCards() {
  document.querySelectorAll(".cards").forEach(function (el) {
    removeChildren(el);
  });
  document.querySelectorAll(".board-column-card-count").forEach(function (el) {
    el.remove();
  });
}

function clearMilestonesList() {
  var elem = document.getElementById("textMilestone");
  removeChildren(elem);
}

function clearAssigneesList() {
  bzAssignees = new Map();
  var elem = document.getElementById("textAssignee");
  removeChildren(elem);
  elem.setAttribute("disabled", "");
}

function filterByAssignee(name) {
  var cards = document.querySelectorAll(".card");
  cards.forEach(function (card) {
    var fullname = card.querySelector(".fullname").innerHTML;
    if (name == fullname || name == "ALL") {
      card.style.display = "block";
    } else {
      card.style.display = "none";
    }
  });

  // force reload
  showColumnCounts();
}

function filterByString(string) {
  var cards = document.querySelectorAll(".card");
  cards.forEach(function (card) {
    var regex = new RegExp(string, "i");
    if (card.innerHTML.match(regex) || string == "") {
      card.style.display = "block";
    } else {
      card.style.display = "none";
    }
  });

  // force reload
  showColumnCounts();
}

function updateUnconfirmedColumnVisibilty() {
  var col = document.querySelector(".board-column#UNCONFIRMED");
  if (col !== null) {
    if (bzProductHasUnconfirmed) {
      col.style.display = "flex";
    } else {
      col.style.display = "none";
    }
  }
}

function debounce(func, wait, immediate) {
  var timeout;

  return function executedFunction() {
    var context = this;
    var args = arguments;

    var later = function () {
      timeout = null;
      if (!immediate) func.apply(context, args);
    };

    var callNow = immediate && !timeout;

    clearTimeout(timeout);

    timeout = setTimeout(later, wait);

    if (callNow) func.apply(context, args);
  };
}

function httpPut(url, dataObj, successCallback, errorCallback) {
  httpRequest("PUT", url, dataObj, successCallback, errorCallback);
}

function httpGet(url, successCallback, errorCallback) {
  httpRequest("GET", url, "", successCallback, errorCallback);
}

function httpRequest(method, url, dataObj, successCallback, errorCallback) {

  var xhr = new XMLHttpRequest();
  xhr.onreadystatechange = function () {
    if (xhr.readyState == XMLHttpRequest.DONE) {
      var response = xhr.responseText;
      if (response === "") {
        var msg =
          "No response from " + bzOptions.siteUrl + url;
        console.warn(msg);
        return;
      }

      var obj = JSON.parse(response);
      if (xhr.status == 200) {
        return successCallback(obj);
      }

      if (obj.error !== null) {
        hideSpinner();
	console.error(obj.message);

        switch (obj.code) {
          case "32000":
            // auth token has expired
            signOut();
            break;
	  case "410":
	    // "You must log in before using this part of Bugzilla."
            if(!loginModalVisible()) {
              showLoginModal();
            }
            break;
        }
        
        if (errorCallback !== undefined) {
          errorCallback(obj);
        } else {
          //alert(obj.message);
        }
      }
    }
  };

  // Append login token to every request.
  // Becase some Bugzilla instances require auth for even viewing bugs, etc.
  if (bzAuthObject !== null) {
    if (url.indexOf("?") == -1) {
      url += "?";
    } else {
      url += "&";
    }

    url += "token=" + bzAuthObject.userToken;
  }

  xhr.open(method, bzOptions.siteUrl + url);
  xhr.setRequestHeader("Accept", "application/json");
  xhr.setRequestHeader("Content-Type", "application/json");
  xhr.send(JSON.stringify(dataObj));
}

function getURLParameter(parameter) {
  return (
    decodeURIComponent(
      (new RegExp("[?|&]" + parameter + "=" + "([^&;]+?)(&|#|;|$)").exec(
        location.search
      ) || [, ""])[1].replace(/\+/g, "%20")
    ) || null
  );
}

function getCardElement(bugId) {
  var bugAttr = '[data-bug-id="' + bugId + '"]';
  return document.querySelector(bugAttr);
}

function showSpinner() {
  document.body.classList.add("busy");
}

function hideSpinner() {
  document.body.classList.remove("busy");
}

function showBacklogButton() {
  var btn = document.querySelector("#btnShowBacklog");
  btn.style.display = "initial";
}

function hideBacklogButton() {
  var btn = document.querySelector("#btnShowBacklog");
  btn.style.display = "none";
}

function showNewBugButton() {
  var btn = document.querySelector("#btnCreate");
  btn.style.display = "initial";
}

function hideNewBugButton() {
  var btn = document.querySelector("#btnCreate");
  btn.style.display = "none";
}

function showNotification(message) {
  var bell = document.querySelector("#notification");
  bell.style.display = "inline";
  bell.title = message;
}

function hideNotification() {
  var bell = document.querySelector("#notification");
  bell.style.display = null;
}

function doAuth(user, password) {
  showSpinner();
  httpGet(
    "/rest.cgi/login?login=" +
      user +
      "&password=" +
      encodeURIComponent(password),
    function (response) {
      bzAuthObject = { userID: response.id, userToken: response.token };
      localStorage.setItem(bzOptions.siteUrl, JSON.stringify(bzAuthObject));
      // force page refresh to rebuild entire page state based on users privelges.
      location.reload();
    },
    function (error) {
      // Login failed.
      showSignInButton();
      alert(error.message);
    }
  );
}

function isLoggedIn() {
  return bzAuthObject !== null;
}

function signOut() {
  localStorage.removeItem(bzOptions.siteUrl);
  showSignInButton();
}

function showSignInButton() {
  document.getElementById("btnSignIn").style.display = "inline-block";
}

function hideSignInButton() {
  document.getElementById("btnSignIn").style.display = "none";
}

function showColumnCounts() {
  var cols = document.querySelectorAll(".board-column");
  cols.forEach(function (col) {
    var cardCount = col.querySelector(".board-column-card-count");
    if (cardCount !== null) {
      cardCount.remove();
    }
    cardCount = document.createElement("span");
    cardCount.className = "board-column-card-count";

    var cards = col.querySelectorAll(".card");
    var count = 0;
    cards.forEach(function (card) {
      // Account for filtered out cards
      if (card.style.display != "none") {
        count++;
      }
    });
    cardCount.innerText += count;
    var title = col.firstChild;
    title.appendChild(cardCount);
  });
}

function writeBug(dataObj) {
  dataObj.token = bzAuthObject.userToken;
  console.log("dataObj in writeBug", dataObj);
  let state = dataObj.state;

  delete dataObj.state;

  httpPut("/rest.cgi/bug/" + dataObj.id, dataObj, function () {
    loadBoard(fetchAllUserBugs, state);
  }, function(bzError) {
        alert(bzError.message);
  });
}

function scheduleCheckForUpdates() {
  window.setTimeout(function () {
    loadCheckForUpdates();
  }, 600000);
}

function dragCardStart(ev) {
}

function dragCardOver(ev) {
  ev.preventDefault();
}

function dragCardEnter(ev) {
  ev.preventDefault();

  if (ev.target.classList.contains("board-column")) {
    ev.currentTarget.classList.add("drag-card");
  }
}

function dragCardLeave(ev) {
  if (ev.target.classList.contains("board-column")) {
    ev.currentTarget.classList.remove("drag-card");
  }
}

function dragCard(ev) {
  // Disable pointer-events for all other cards so that we
  // can reliably detect when a card enters and leaves a column.
  var cards = document.querySelectorAll(".card");
  cards.forEach(function(card) {
    if (card.dataset.bugId != ev.currentTarget.dataset.bugId) {
      card.style.pointerEvents = "none";
    }
  });

  var card = ev.currentTarget;
  var bugID = card.dataset.bugId;
  var bugData = {
    id: bugID,
    status: card.dataset.bugStatus,
    priority: card.dataset.bugPriority,
    severity: card.dataset.bugSeverity
  };
  ev.dataTransfer.setData("text", JSON.stringify(bugData));
}

function dragCardEnd(ev) {
  // Re-enable pointer events for all cards.
  var cards = document.querySelectorAll(".card");
  cards.forEach(function(card) {
    card.style.pointerEvents = "auto";
  });
}

function dropCard(ev) {
  var col = ev.currentTarget;
  col.classList.remove("drag-card");

  ev.preventDefault();

  var bugCurrent = JSON.parse(ev.dataTransfer.getData("text"));

  var bugUpdate = {};
  bugUpdate.id = bugCurrent.id;
  if (ev.currentTarget.id === "BACKLOG") {
    bugUpdate.status = bzOptions.backlogDefaultStatus;
    bugUpdate.target_milestone = "---";
    bugUpdate.priority = bzDefaultPriority;
  } else {
    bugUpdate.status = ev.currentTarget.id;
    bugUpdate.target_milestone = bzProductMilestone;
  }
  console.log("bugUpdate", bugUpdate);

  if (bzOptions.addCommentOnChange) {
    showBugModal(bugCurrent, bugUpdate);
  } else {
    writeBug(bugUpdate);
  }
}

function showBacklog() {
  var button = document.getElementById("btnShowBacklog");
  var backlogCol = document.querySelector("#BACKLOG.board-column");

  if (!isBacklogVisible()) {
    var backlog = backlogCol.querySelector(".cards");
    if (backlog.children.length === 0) {
      // Load backlog on first access.
      loadBacklogCards();
    }

    backlogCol.style.display = null;
    button.innerText = "Hide Backlog";
  }
}

function hideBacklog() {
  var button = document.getElementById("btnShowBacklog");
  var backlogCol = document.querySelector("#BACKLOG.board-column");

  if (isBacklogVisible()) {
    var backlog = backlogCol.querySelector(".cards");
    backlogCol.style.display = "none";
    button.innerText = "Show Backlog";
  }
}

function isBacklogVisible() {
  var backlogCol = document.querySelector("#BACKLOG.board-column");

  if (backlogCol.style.display === "") {
    return true;
  } else {
    return false;
  }
}

function loadBacklogCards(callback) {
  showSpinner();

  bzRestGetBacklogUrl = "/rest.cgi/bug?product=" + bzProduct;
  bzRestGetBacklogUrl +=
    "&include_fields=summary,status,id,severity,priority,assigned_to,last_updated,deadline";
  bzRestGetBacklogUrl += "&order=" + bzOptions.order;
  bzRestGetBacklogUrl += "&target_milestone=---";
  bzRestGetBacklogUrl += "&resolution=---";
  bzRestGetBacklogUrl += "&component=" + bzComponent;
  bzRestGetBacklogUrl += "&priority=" + bzPriority;

  httpGet(bzRestGetBacklogUrl, function (response) {
    hideSpinner();
    var bugs = response.bugs;
    var backlogCards = document.querySelector("#BACKLOG" + " .cards");

    bugs.forEach(function (bug) {
      var card = createCard(bug);
      backlogCards.appendChild(card);
    });

    // force a recount now that we have a new column.
    showColumnCounts();

    if (callback !== undefined) {
      callback();
    }
  });
}

function isTrue(string) {
  return string === "true";
}

// https://stackoverflow.com/a/3955238/52176
function removeChildren(elem) {
  while (elem.firstChild) {
    elem.removeChild(elem.firstChild);
  }
}

function getGravatarImgSrc(email) {
  var hash = CryptoJS.MD5(email.toLowerCase());
  var hashString = hash.toString(CryptoJS.enc.Base64);

  if (hashString !== "") {
    return (
      "https://www.gravatar.com/avatar/" + hashString + "?s=20&d=identicon"
    );
  }
}

function updateAddressBar() {
  var currentURL = location.href;
  var newURL = currentURL.split("?")[0]; // trim off params
  newURL += "?product=" + bzProduct;
  newURL += "&milestone=" + bzProductMilestone;
  newURL += "&assignee=" + bzAssignedTo;
  newURL += "&comments=" + bzOptions.loadComments;
  newURL += "&autorefresh=" + bzOptions.autoRefresh;
  newURL += "&site=" + bzOptions.siteUrl;

  history.pushState({}, "", newURL);
}

function createModal(elementId) {
  var modal = document.createElement("div");
  modal.id = elementId;
  modal.className = "modal";

  // When the user clicks anywhere outside of the modal, close it
  modal.addEventListener("click", function (e) {
    if (e.target == modal) {
      hideModalCheckDraft();
    }
  });

  var content = document.createElement("div");
  content.className = "modal-content";

  var header = document.createElement("div");
  header.className = "modal-header";

  var close = document.createElement("i");
  close.className = "fa fa-close modalClose";
  close.title = "Close window";
  close.onclick = function () {
    hideModalCheckDraft();
  };

  header.appendChild(close);

  var body = document.createElement("div");
  body.className = "modal-body";

  var footer = document.createElement("div");
  footer.className = "modal-footer";

  content.appendChild(header);
  content.appendChild(body);
  content.appendChild(footer);
  modal.appendChild(content);

  return modal;
}

function showNewBugModal() {
  var modal = createModal("modalNewBug");
  var header = modal.querySelector(".modal-header");
  var body = modal.querySelector(".modal-body");
  var footer = modal.querySelector(".modal-footer");

  var title = document.createTextNode(
    "Add new bug to milestone " + bzProductMilestone
  );
  header.appendChild(title);

  var comments = document.createElement("div");
  comments.className = "bug-comments";

  var meta = document.createElement("div");
  meta.className = "bug-meta";

  var summaryLabel = document.createElement("label");
  summaryLabel.innerText = "Summary";
  var summary = document.createElement("input");
  summary.id = "textAddBugSummary";
  summary.name = "summary";
  summary.type = "text";
  summaryLabel.appendChild(summary);

  var descriptionLabel = document.createElement("label");
  descriptionLabel.innerText = "Description";
  var description = document.createElement("textarea");
  description.id = "textAddBugDescription";
  description.name = "description";
  descriptionLabel.appendChild(description);

  var componentLabel = document.createElement("label");
  componentLabel.innerText = "Component";
  var components = document.createElement("select");
  components.id = "textComponent";
  components.name = "component";
  componentLabel.appendChild(components);

  var versionLabel = document.createElement("label");
  versionLabel.innerText = "Version";
  var versions = document.createElement("select");
  versions.id = "textVersion";
  versions.name = "version";
  versionLabel.appendChild(versions);

  var submit = document.createElement("button");
  submit.innerText = "Submit";
  submit.id = "submitNewBug";
  submit.onclick = function () {
    var dataObj = {
      product: bzProduct,
      component: document.getElementById("textComponent").value,
      summary: document.getElementById("textAddBugSummary").value,
      description: document.getElementById("textAddBugDescription").value,
      version: document.getElementById("textVersion").value,
      // Bugzilla web CGI kicks in if opsys and platform default is blank
      // doing code to detect through the browser.
      // TODO: Write js detection code if blank is detected
      op_sys: "ALL",
      platform: "ALL",
      target_milestone: bzProductMilestone
    };

    httpRequest("POST", "/rest.cgi/bug", dataObj, function () {
      loadBoard();
    });

    hideModal();
  };

  comments.appendChild(summaryLabel);
  comments.appendChild(descriptionLabel);
  meta.appendChild(componentLabel);
  meta.appendChild(versionLabel);

  body.appendChild(comments);
  body.appendChild(meta);

  footer.appendChild(submit);

  bzProductComponents.forEach(function (component) {
    var opt = document.createElement("option");
    opt.innerText = component;
    opt.value = component;
    components.appendChild(opt);
  });

  bzProductVersions.forEach(function (version) {
    var opt = document.createElement("option");
    opt.innerText = version;
    opt.value = version;
    versions.appendChild(opt);
  });

  document.querySelector(bzOptions.domElement).appendChild(modal);
}

function showBugModal(bugCurrent, bugUpdate) {
  var modal = createModal("modalBug");
  var body = modal.querySelector(".modal-body");
  var header = modal.querySelector(".modal-header");
  var footer = modal.querySelector(".modal-footer");

  var card = getCardElement(bugCurrent.id);
  var bugTitle = document.createElement("span");
  bugTitle.innerText = card.querySelector(".card-summary").innerText; // grab title from card
  bugTitle.className = "card-summary";
  bugTitle.onclick = function () {
    var inputBugTitle = document.createElement("input");
    inputBugTitle.id = "card-summary-new";
    inputBugTitle.value = bugTitle.innerText;
    bugTitle.parentNode.replaceChild(inputBugTitle, bugTitle);
  };
  var bugNumber = createBugNumberElement(bugCurrent.id);

  header.appendChild(bugTitle);
  header.appendChild(bugNumber);

  var comments = document.createElement("div");
  comments.className = "bug-comments";

  var meta = document.createElement("div");
  meta.className = "bug-meta";

  body.appendChild(comments);
  body.appendChild(meta);

  if (bzOptions.requiresResolution[bugUpdate.status]) {
    //  Resolution field.
    var resolutionLabel = document.createElement("label");
    resolutionLabel.innerText = "Resolution";
    var resolutions = document.createElement("select");
    resolutions.name = "resolution";
    resolutionLabel.appendChild(resolutions);

    bzProductResolutions.forEach(function (resolution) {
      var opt = document.createElement("option");
      opt.innerText = resolution;
      opt.value = resolution;
      if (resolution === bugCurrent.resolution) {
        opt.selected = true;
      }
      resolutions.appendChild(opt);
    });

    // Set to default value, and add change listener
    bugUpdate.resolution = resolutions.value;
    resolutions.onchange = function () {
      bugUpdate.resolution = resolutions.value;
    };

    meta.appendChild(resolutionLabel);
  }

  // Card was clicked
  if (bugCurrent.status === bugUpdate.status) {
    body.style.display = "none"; // HACK: hide until comments reponse comes back so layout isn't broken.

    showSpinner();

    // Show comments and description
    httpGet(
      "/rest.cgi/bug/" +
        bugCurrent.id +
        "/comment?include_fields=text,time,creator",
      function (response) {
        hideSpinner();
        var commentsObj = response.bugs[bugCurrent.id].comments;

        for (var comment in commentsObj) {
          var commentLabel = document.createElement("label");
          if (comment === "0") {
            commentLabel.innerText = "Description";
          } else {
            commentLabel.innerText = "Comment " + comment;
          }
          var commentText = document.createElement("div");
          commentText.className = "bug-comment";
          commentText.innerText = commentsObj[comment].text;
          commentText.innerHTML = linkifyHtml(commentText.innerHTML, {
            // Only linkify links that begin with http or https protocol.
            // e.g., "http://google.com" will be linkified, but "google.com" will not.
            // This avoids things like filenames (e.g. foobar.txt) from being interpretted as links.
            validate: {
              url: function (value) {
                return /^https?:\/\//.test(value);
              }
            }
          });

          var date = new Date(commentsObj[comment].time);
          var commentDate = document.createElement("span");
          commentDate.className = "bug-comment-date";
          commentDate.title = date;
          commentDate.innerText = new timeago().format(date);
          commentDate.innerText += " by " + commentsObj[comment].creator;

          commentLabel.appendChild(commentDate);
          commentLabel.appendChild(commentText);
          comments.appendChild(commentLabel);
        }

        comments.appendChild(createCommentsBox());

        body.style.display = null; // unhide it
      }
    );

    // Priority field.
    var priorityLabel = document.createElement("label");
    priorityLabel.innerText = "Priority";
    var priorities = document.createElement("select");
    priorities.name = "priority";
    priorityLabel.appendChild(priorities);

    bzProductPriorities.forEach(function (priority) {
      var opt = document.createElement("option");
      opt.innerText = priority;
      opt.value = priority;
      if (priority === bugCurrent.priority) {
        opt.selected = true;
      }
      priorities.appendChild(opt);
    });

    // Set to default value, and add change listener
    bugUpdate.priority = priorities.value;
    priorities.onchange = function () {
      bugUpdate.priority = priorities.value;
    };

    meta.appendChild(priorityLabel);

    // Severity field.
    var severityLabel = document.createElement("label");
    severityLabel.innerText = "Severity";
    var severities = document.createElement("select");
    severities.name = "severity";
    severityLabel.appendChild(severities);

    bzProductSeverities.forEach(function (severity) {
      var opt = document.createElement("option");
      opt.innerText = severity;
      opt.value = severity;
      if (severity === bugCurrent.severity) {
        opt.selected = true;
      }
      severities.appendChild(opt);
    });

    // Set to default value, and add change listener
    bugUpdate.severity = severities.value;
    severities.onchange = function () {
      bugUpdate.severity = severities.value;
    };

    meta.appendChild(severityLabel);
  } else {
    // Card was dragged

    // TODO show what's changed in modal as confirmation?
    console.log(
      "Bug " +
        bugCurrent.id +
        " moved from " +
        bugCurrent.status +
        " to " +
        bugUpdate.status
    );

    comments.appendChild(createCommentsBox());
  }

  var submit = document.createElement("button");
  submit.innerText = "Submit";
  submit.id = "submitComment";
  submit.onclick = function () {
    bugUpdate.comment = {};
    bugUpdate.comment.body = document.querySelector("#commentBoxText").value;
    let workTime = parseInt(document.querySelector("#workTime").value) > 0 ? parseInt(document.querySelector("#workTime").value) : 1;
    let productiveTime = parseInt(document.querySelector("#productiveTime").value) > 0 ? parseInt(document.querySelector("#productiveTime").value) : 1;
    bugUpdate.work_time = Math.ceil((workTime / 60) * 100) / 100;
    bugUpdate.productive_time = Math.ceil((productiveTime / 60) * 100) / 100;
    let state = document.getElementById(`${bugUpdate.id}`).dataset.state;
    bugUpdate.state = state;

    if (productiveTime > workTime) {
      alert("Productive time mustn't greater than work time");
    } else if (bugUpdate.productive_time > 1 && document.querySelector("#commentBoxText").value.length < bugUpdate.productive_time * 60) {
      alert("You shouldn't write such a short comment. We want you to write 60 symbols for each hour as minimal");
    } else if (bugUpdate.productive_time > 3) {
      alert("You shouldn't write all of your work in one comment, if you put productive time greater than 3 hours");
    } else if (bugUpdate.work_time > 8) {
      alert("You shouldn't put your work time greater than 8 hours.")
    } else {
      var newBugSummary = document.querySelector("#card-summary-new");
      if (newBugSummary) {
        bugUpdate.summary = newBugSummary.value;
      }

      hideModal();
      writeBug(bugUpdate);
    }
  };

  footer.appendChild(submit);

  document.querySelector(bzOptions.domElement).appendChild(modal);
}

function modalHasDraft() {
  var commentBox = document.querySelector(".modal #commentBoxText");
  if (commentBox != null) {
    return commentBox.value.length > 0;
  }
  return false;
}

function hideModalCheckDraft() {
  if (modalHasDraft()) {
    if (!confirm("Discard your changes?")) {
      return;
    }
  }

  hideModal();
}

function hideModal() {
  var modal = document.querySelector(".modal");
  if (modal !== null) {
    modal.remove();
  }
}

function createCommentsBox() {
  // Add enterable textarea for new comment
  let commentContainer = document.createElement("div");

  var commentBoxLabel = document.createElement("label");
  commentBoxLabel.innerText = "Additional Comments";

  var commentBox = document.createElement("textarea");
  commentBox.id = "commentBoxText";
  commentBox.placeholder = "Write coment...";

  commentBoxLabel.appendChild(commentBox);

  let timeLabel = document.createElement("label");
  timeLabel.innerText = "Put work time:"

  let workTimeTitle = document.createElement("div");
  workTimeTitle.classList.add("time-title");
  workTimeTitle.innerHTML = "Work time";

  let workTime = document.createElement("input");
  workTime.id = "workTime";
  workTime.placeholder = "Work time in minutes";
  workTime.onkeypress = validate;
  workTime.onpaste = validate;

  let productiveTimeTitle = document.createElement("div");
  productiveTimeTitle.classList.add("time-title");
  productiveTimeTitle.innerHTML = "Productive time";

  let productiveTime = document.createElement("input");
  productiveTime.id = "productiveTime";
  productiveTime.placeholder = "Productive time in minutes";
  productiveTime.onkeypress = validate;
  productiveTime.onpaste = validate;

  timeLabel.appendChild(workTimeTitle);
  timeLabel.appendChild(workTime);
  timeLabel.appendChild(productiveTimeTitle);
  timeLabel.appendChild(productiveTime);

  commentContainer.appendChild(commentBoxLabel);
  commentContainer.appendChild(timeLabel);

  return commentContainer;
}

function createBugNumberElement(bugId) {
  var bugNumber = document.createElement("a");
  bugNumber.className = "card-ref";
  bugNumber.innerHTML = "#" + bugId;
  bugNumber.href = bzOptions.siteUrl + "/show_bug.cgi?id=" + bugId;
  bugNumber.target = "_blank"; // open in new tab
  bugNumber.onclick = function (ev) {
    // On click follow href link.
    // And prevent event propagation up to card click handler, which would cause modal to be shown.
    ev.stopPropagation();
  };
  return bugNumber;
}

function loadEmailAddress(callback) {
  // Avoid doing request if no assignees. Happens on empty board.
  // The "ALL" user counts as one entry, ignore it.
  if (bzAssignees.size === 1) {
    return callback();
  }

  var idUrl = "";
  bzAssignees.forEach(function (user) {
    if (user.id === undefined) {
      return;
    }
    idUrl += "ids=" + user.id + "&";
  });
  httpGet("/rest.cgi/user?" + idUrl + "include_fields=email,name", function (
    response
  ) {
    response.users.forEach(function (user) {
      var userDetail = bzAssignees.get(user.name);
      userDetail.email = user.email;

      if (user.email !== undefined) {
        updateGravatarIcons(user);
      }

    });
    callback();
  });
}

function updateGravatarIcons(user) {
  var gravatarIcons = document.querySelectorAll(
    ".assignee[data-assignee-name='" + user.name + "'] .gravatar"
  );
  var gravatar = getGravatarImgSrc(user.email);
  gravatarIcons.forEach(function (icon) {
    icon.src = gravatar;
    icon.style.display = "block";
  });
}

// Register event handlers

// Background checking for updates to visible cards
document.addEventListener("visibilitychange", function () {
  if (document.hidden) {
    bzOptions.checkForUpdates = false;
  } else {
    bzOptions.checkForUpdates = true;
    loadCheckForUpdates();
  }
});

document.addEventListener("keyup", function (e) {
  if (e.code === "Escape") {
    hideModalCheckDraft();
  }
});

async function fetchAllUserBugs(state) {
  if (state !== undefined) {
    // reset all if it was a callback
    history.pushState({}, "", "?state=user_bugs");
    document.querySelector("#btnCreate").style.display = "none";
    Array.from(document.querySelectorAll(".board-column-card-count")).map((elem) => { elem.remove() });
    console.log("state is", state);
    let uname =
      bzOptions.siteUrl +
      "/rest/user/" +
      bzAuthObject.userID +
      "?token=" +
      bzAuthObject.userToken +
      "&include_fields=name";
    let response = await fetch(uname);
    let name = await response.json();
    name = name.users[0].name;

    let allBugsUrl =
      bzOptions.siteUrl +
      "/rest/bug?token=" +
      bzAuthObject.userToken +
      "&" +
      state +
      "=" +
      name;
    let allBugsResponse = await fetch(allBugsUrl);
    let allBugs = await allBugsResponse.json();

    initBugs(allBugs.bugs, state);
  }
}

function initBugs(bugs, state) {
  Array.from(document.querySelectorAll(".card")).map((elem) => {
    elem.remove();
  });

  Array.from(bugs).map((bug) => {
    console.log('this is bug', bug)
    let status = bug.status;
    let id = bug.id;
    let assignedTo = bug.assigned_to;
    let summary = bug.summary;
    let severity = bug.severity;
    let priority = bug.priority;
    let milestone = bug.target_milestone;
    //let product = bug.product;
    let lastChangeTime = new Date(bug.last_change_time);
    let currTime = new Date();
    let maxTimeDiff = 14; // time diff in days
    let timeDiff = Math.floor(
      (currTime - lastChangeTime) / 1000 / 60 / 60 / 24
    ); // get diff currTime lastChangeTime in days

    if (timeDiff < maxTimeDiff) {
      document.querySelector(
        "#" + status + " .board-column-content .cards"
      ).innerHTML +=
        `
	  <div class="card" id="${id}" data-bug-id="${id}" data-state="${state}" data-bug-status="${status}" data-bug-priority="${priority}" data-bug-severity="${severity}" data-bug-resolution="" data-bug-milestone="${milestone}" draggable="true">
            <div class="card-summary">${summary}</div>
            <div class="card-meta">
              <span class="badges">
                <span class="badge bug-number">
                  <a class="card-ref" href="${bzOptions.siteUrl}/show_bug.cgi?id=${id}" target="_blank">#${id}</a>
                </span>
                <span class="badge priority" title="Priority" data-priority="${priority}">${priority}</span>
                <span class="badge severity" title="Severity" data-severity="${severity}">${severity}</span>
              </span>
              <span title="Assignee" class="assignee" data-assignee-name="${assignedTo}">
	        <span class="fullname">${assignedTo}</span>
                <img class="gravatar" style="display: block;" src="${getGravatarImgSrc(bug.assigned_to_detail.email)}">
              </span>
            </div>
          </div>
        `;
    }
  });
  if (isLoggedIn() && bzOptions.allowEditBugs) {
    // console.log('is logged?', isLoggedIn(), 'is allowEditBugs', bzOptions.allowEditBugs)
    Array.from(document.querySelectorAll(".card")).map((elem) => {
      elem.addEventListener("dragstart", function (event) {
        // fix draggable
        bzProductMilestone = this.dataset.bugMilestone;
	//bzProduct = this.dataset.bugProduct;
        dragCard(event);
      });

      elem.addEventListener("click", function (event) {
        let bugObject = {};
        bugObject.id = this.dataset.bugId;
        bugObject.status = this.dataset.bugStatus;
        bugObject.priority = this.dataset.bugPriority;
        bugObject.severity = this.dataset.bugSeverity;
        bugObject.resolution = this.dataset.bugResolution;

        showBugModal(bugObject, bugObject);
      });
    });
  }
}

function validate (evt) {
  let theEvent = evt || window.event;
  let key = theEvent.keyCode || theEvent.which;
  key = String.fromCharCode(key);
  let regex = /[0-9\s]/;
  if (!regex.test(key)) {
    theEvent.returnValue = false;
    if (theEvent.preventDefault) theEvent.preventDefault();   
  } 
};
