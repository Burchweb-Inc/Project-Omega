const express = require("express");
module.exports = ({requireUser, orgModel, render}) => {
  const router = express.Router();
  const newOrgPage = (request, response) => render(request, response, "new-org");
  const groupsPage = (request, response) => render(request, response, "groups", {
    groups: orgModel.forUserOrInvite(request.user.id)
  });

  router.get(["/org/new", "/group/new"], requireUser, newOrgPage);
  router.get("/groups", requireUser, groupsPage);

  router.handlers = { newOrgPage, groupsPage };
  return router;
};
