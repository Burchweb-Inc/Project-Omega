const assert = require('node:assert/strict');
const test = require('node:test');
const routes = require('../org/routes');

function createRouter({ policyError = null } = {}) {
  const renders = [];
  const creates = [];
  const user = { id: 'user-1' };
  const groups = [
    { id: 'member-org', name: 'Member org' },
    { id: 'invite-org', name: 'Invited org' }
  ];
  const middleware = (request, response, next) => next();
  const router = routes({
    requireUser: middleware,
    contentPolicyError: async (input) => {
      assert.equal(input.type, 'text');
      return policyError;
    },
    orgModel: {
      forUserOrInvite(userId) {
        assert.equal(userId, user.id);
        return groups;
      },
      create(input) {
        creates.push(input);
        return { id: 'new-org', slug: 'new-study-space' };
      }
    },
    render(request, response, page, data) {
      renders.push({ page, data });
    }
  });

  return { handlers: router.handlers, renders, creates, user };
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

test('POST /orgs redirects to the new group when the name is empty', async () => {
  const { handlers, creates, user } = createRouter();
  const redirects = [];

  await handlers.createOrg({ user, body: { name: '  ', description: 'description' } }, {
    redirect(path) {
      redirects.push(path);
    }
  });

  assert.deepEqual(redirects, ['/group/new']);
  assert.deepEqual(creates, []);
});

test('POST /groups/new redirects back when content policy rejects the org', async () => {
  const { handlers, creates, user } = createRouter({ policyError: 'blocked' });
  const redirects = [];

  await handlers.createOrg({ user, body: { name: ' Study space ', description: ' Description ' } }, {
    redirect(path) {
      redirects.push(path);
    }
  });

  assert.deepEqual(redirects, ['/group/new?error=policy']);
  assert.deepEqual(creates, []);
});

test('POST /orgs creates the org with trimmed fields and redirects to it', async () => {
  const { handlers, creates, user } = createRouter();
  const redirects = [];

  await handlers.createOrg({ user, body: { name: ' Study space ', description: ' Description ' } }, {
    redirect(path) {
      redirects.push(path);
    }
  });

  assert.deepEqual(creates, [{ userId: 'user-1', name: 'Study space', description: 'Description' }]);
  assert.deepEqual(redirects, ['/group/new-study-space']);
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
