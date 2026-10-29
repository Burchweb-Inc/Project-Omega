const express = require("express");
module.exports = ({requireUser, contentPolicyError, orgModel, render, creatorTimezone}) => {
  const router = express.Router();
  const newOrgPage = (request, response) => render(request, response, "new-org");
  const groupsPage = (request, response) => render(request, response, "groups", {
    groups: orgModel.forUserOrInvite(request.user.id)
  });

  router.get(["/org/new", "/group/new"], requireUser, newOrgPage);
  router.get("/groups", requireUser, groupsPage);
  const createOrg = async (request, response) => {
    const name = String(request.body.name || '').trim();
    if (!name) return response.redirect('/group/new');
    const description = String(request.body.description || '').trim();
    if (await contentPolicyError({ type: 'text', text: `${name} ${description}` })) return response.redirect('/group/new?error=policy');
    const timezone = creatorTimezone ? await creatorTimezone(request.user, request) : request.user.settings?.timezone || 'UTC';
    const org = orgModel.create({ userId: request.user.id, name, description, timezone });
    response.redirect(`/group/${org.slug}`);
  };

  router.post(['/orgs', '/groups/new'], requireUser, createOrg);

  router.handlers = { newOrgPage, groupsPage, createOrg };
  return router;
};
