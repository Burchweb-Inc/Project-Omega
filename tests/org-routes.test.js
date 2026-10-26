const assert = require('node:assert/strict');
const test = require('node:test');
const routes = require('../org/routes');

function createRouter() {
  const renders = [];
  const user = { id: 'user-1' };
  const groups = [
    { id: 'member-org', name: 'Member org' },
    { id: 'invite-org', name: 'Invited org' }
  ];
  const middleware = (request, response, next) => next();
  const router = routes({
    requireUser: middleware,
    orgModel: {
      forUserOrInvite(userId) {
        assert.equal(userId, user.id);
        return groups;
      }
    },
    render(request, response, page, data) {
      renders.push({ page, data });
    }
  });

  return { handlers: router.handlers, renders, user };
}

test('GET /org/new renders the new-org page', () => {
  const { handlers, renders, user } = createRouter();

  handlers.newOrgPage({ user }, {});

  assert.deepEqual(renders, [{ page: 'new-org', data: undefined }]);
});

test('GET /group/new renders the new-org page', () => {
  const { handlers, renders, user } = createRouter();

  handlers.newOrgPage({ user }, {});

  assert.deepEqual(renders, [{ page: 'new-org', data: undefined }]);
});

test('GET /groups renders orgs returned for the current user', () => {
  const { handlers, renders, user } = createRouter();

  handlers.groupsPage({ user }, {});

  assert.deepEqual(renders, [{
    page: 'groups',
    data: {
      groups: [
        { id: 'member-org', name: 'Member org' },
        { id: 'invite-org', name: 'Invited org' }
      ]
    }
  }]);
});
