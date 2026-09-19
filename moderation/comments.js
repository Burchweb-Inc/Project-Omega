'use strict';

function moderationComments(org) {
  const courseComments = (org.courses || []).flatMap((course) => (course.items || []).flatMap((item) => (item.comments || []).map((comment) => ({ ...comment, source: item.title, sourceType: 'course item', container: item }))));
  const groupComments = (org.groups || []).flatMap((group) => (group.comments || []).map((comment) => ({ ...comment, source: group.name, sourceType: 'breakout group', container: group })));
  return [...courseComments, ...groupComments].sort((left, right) => new Date(right.createdAt || 0) - new Date(left.createdAt || 0));
}

function findReportedComment(org, commentId) {
  for (const course of org.courses || []) for (const item of course.items || []) {
    const comment = (item.comments || []).find((entry) => entry.id === commentId);
    if (comment) return { comment, item, course, group: null };
  }
  for (const group of org.groups || []) {
    const comment = (group.comments || []).find((entry) => entry.id === commentId);
    if (comment) return { comment, item: null, course: null, group };
  }
  return null;
}

function findReportTarget(org, contentId) {
  const commentTarget = findReportedComment(org, contentId);
  if (commentTarget) return { type: 'comment', ...commentTarget };
  for (const course of org.courses || []) {
    const item = (course.items || []).find((entry) => entry.id === contentId);
    if (item) return { type: 'item', item, course, comment: null, group: null };
  }
  return null;
}

function commentHistory(comment) {
  return Array.isArray(comment.history) ? comment.history : [];
}

function canEditComment(comment, org, user, group = null) {
  return comment?.userId === user?.id || (group ? canManageBreakoutGroup(org, group, user) : isOrgModerator(org, user));
}

function editComment(comment, text, user) {
  comment.history = commentHistory(comment);
  comment.history.push({ text: comment.text, editedAt: new Date().toISOString(), editedBy: user.id, editorName: user.name });
  comment.text = text;
  comment.editedAt = new Date().toISOString();
  comment.editedBy = user.id;
}

function registerCommentRoutes({ app, orgs, users, id, persistState, emitCourse, emitGroup, sendMutation, requireUser, getOrg, canAccess, isOrgAdmin, isOrgModerator, canManageBreakoutGroup, contentPolicyError, addNotification }) {
  app.post('/org/:id/items/:itemId/comments', requireUser, async (request, response) => {
    const org = getOrg(request);
    const item = canAccess(org, request.user) ? org.courses.flatMap((course) => course.items).find((entry) => entry.id === request.params.itemId) : null;
    const text = String(request.body.comment || '').trim();
    if (!item || !text) return sendMutation(request, response, { error: 'A comment is required.' }, `/org/${request.params.id}`);
    const policyError = await contentPolicyError({ type: 'comment', text, previousMessages: item.comments });
    if (policyError) return sendMutation(request, response, { error: policyError }, `/org/${org.id}`);
    const comment = { id: id(), author: request.user.name, userId: request.user.id, text, createdAt: new Date().toISOString(), history: [] };
    item.comments ||= [];
    item.comments.push(comment);
    persistState();
    const course = org.courses.find((entry) => entry.items.includes(item));
    emitCourse(org, course, 'item:comment-added', { itemId: item.id, comment });
    return sendMutation(request, response, { itemId: item.id, comment }, `/org/${org.id}/course/${course.id}`);
  });

  app.post('/org/:id/items/:itemId/comments/:commentId/update', requireUser, async (request, response) => {
    const org = getOrg(request);
    const course = org?.courses.find((entry) => entry.items.some((item) => item.id === request.params.itemId));
    const item = course?.items.find((entry) => entry.id === request.params.itemId);
    const comment = item?.comments?.find((entry) => entry.id === request.params.commentId);
    const text = String(request.body.comment || '').trim();
    if (!org || !item || !comment || !text || !canEditComment(comment, org, request.user)) return sendMutation(request, response, { error: 'You cannot edit this comment.' }, `/org/${org?.id || ''}`);
    const policyError = await contentPolicyError({ type: 'comment', text, previousMessages: item.comments });
    if (policyError) return sendMutation(request, response, { error: policyError }, `/org/${org.id}/course/${course.id}`);
    editComment(comment, text, request.user);
    persistState();
    emitCourse(org, course, 'item:comment-updated', { itemId: item.id, comment });
    return sendMutation(request, response, { itemId: item.id, comment }, `/org/${org.id}/course/${course.id}`);
  });

  app.post('/org/:id/items/:itemId/comments/:commentId/delete', requireUser, (request, response) => {
    const org = getOrg(request); const course = org?.courses.find((entry) => entry.items.some((item) => item.id === request.params.itemId)); const item = course?.items.find((entry) => entry.id === request.params.itemId); const comment = item?.comments?.find((entry) => entry.id === request.params.commentId);
    if (!org || !item || !comment || !isOrgModerator(org, request.user)) return sendMutation(request, response, { error: 'Only moderators and admins can delete comments.' }, `/org/${org?.id || ''}`);
    item.comments = item.comments.filter((entry) => entry.id !== comment.id); persistState(); emitCourse(org, course, 'item:comment-deleted', { itemId: item.id, commentId: comment.id });
    return sendMutation(request, response, { itemId: item.id, commentId: comment.id }, `/org/${org.id}/course/${course.id}`);
  });

  app.post('/org/:id/breakout/:groupId/comments', requireUser, async (request, response) => {
    const org = getOrg(request); const group = org && org.groups?.find((entry) => entry.id === request.params.groupId); const text = String(request.body.comment || '').trim();
    if (!group || !canAccess(org, request.user) || !text) return sendMutation(request, response, { error: 'A comment is required.' }, `/org/${request.params.id}`);
    const policyError = await contentPolicyError({ type: 'group-comment', text, previousMessages: group.comments });
    if (policyError) return sendMutation(request, response, { error: policyError }, `/org/${org.id}/breakout/${group.id}`);
    group.comments ||= [];
    const comment = { id: id(), author: request.user.name, userId: request.user.id, text, createdAt: new Date().toISOString(), history: [] };
    group.comments.push(comment); persistState(); emitGroup(org, 'breakout:comment-created', { groupId: group.id, comment });
    return sendMutation(request, response, { comment }, `/org/${org.id}/breakout/${group.id}`);
  });

  app.post('/org/:id/breakout/:groupId/comments/:commentId/update', requireUser, async (request, response) => {
    const org = getOrg(request); const group = org && org.groups?.find((entry) => entry.id === request.params.groupId); const comment = group?.comments?.find((entry) => entry.id === request.params.commentId); const text = String(request.body.comment || '').trim();
    if (!org || !group || !comment || !text || !canEditComment(comment, org, request.user, group)) return sendMutation(request, response, { error: 'You cannot edit this comment.' }, `/org/${request.params.id}`);
    const policyError = await contentPolicyError({ type: 'group-comment', text, previousMessages: group.comments });
    if (policyError) return sendMutation(request, response, { error: policyError }, `/org/${org.id}/breakout/${group.id}`);
    editComment(comment, text, request.user); persistState(); emitGroup(org, 'breakout:comment-updated', { groupId: group.id, comment });
    return sendMutation(request, response, { comment }, `/org/${org.id}/breakout/${group.id}`);
  });

  app.post('/org/:id/breakout/:groupId/comments/:commentId/delete', requireUser, (request, response) => {
    const org = getOrg(request); const group = org?.groups?.find((entry) => entry.id === request.params.groupId);
    if (!group || !canManageBreakoutGroup(org, group, request.user)) return sendMutation(request, response, { error: 'You cannot delete this comment.' }, `/org/${request.params.id}`);
    group.comments = (group.comments || []).filter((comment) => comment.id !== request.params.commentId); persistState(); emitGroup(org, 'breakout:comment-deleted', { groupId: group.id, commentId: request.params.commentId });
    return sendMutation(request, response, { commentId: request.params.commentId }, `/org/${org.id}/breakout/${group.id}`);
  });

  app.post('/org/:id/content-reports', requireUser, (request, response) => {
    const org = getOrg(request); const target = findReportTarget(org, String(request.body.contentId || ''));
    if (!org || !target || !canAccess(org, request.user)) return sendMutation(request, response, { error: 'That content is no longer available.' }, `/org/${org?.id || ''}`);
    const reason = String(request.body.reason || 'Inappropriate content').trim(); const detail = String(request.body.detail || '').trim();
    if (target.comment) { target.comment.reported = true; target.comment.reportedAt = new Date().toISOString(); target.comment.reportedBy = request.user.id; target.comment.reportReason = reason; }
    const contentText = target.comment?.text || `${target.item.type}: ${target.item.title}`;
    org.reports ||= []; org.reports.push({ id: id(), type: 'content', contentId: target.comment?.id || target.item.id, contentType: target.type, contentText, reporter: request.user.username, reporterRole: membershipRole(org, request.user), reason, detail, status: 'open', createdAt: new Date().toISOString() });
    for (const member of org.members || []) if (['admin', 'moderator'].includes(member.role) && member.userId !== request.user.id) addNotification?.(users.find((user) => user.id === member.userId), { type: 'content-report', title: `New report in ${org.name}`, message: `${request.user.name} reported ${reason.toLowerCase()}: ${detail || 'No additional details.'}`, href: `/org/${org.id}/admin/report`, actionLabel: 'Review report' });
    persistState();
    if (target.item && target.comment) emitCourse(org, target.course, 'item:comment-reported', { itemId: target.item.id, commentId: target.comment.id });
    if (target.group) emitGroup(org, 'breakout:comment-reported', { groupId: target.group.id, commentId: target.comment.id });
    return sendMutation(request, response, { reported: true, contentId: target.comment?.id || target.item.id, successMessage: 'Report submitted. Thanks for helping keep this group healthy.' }, `/org/${org.id}`);
  });

  app.post(['/group/:slug/admin/comments/:commentId/remove', '/org/:id/admin/comments/:commentId/remove'], requireUser, (request, response) => {
    const org = getOrg(request);
    if (!org || !isOrgModerator(org, request.user)) return sendMutation(request, response, { error: 'Only moderators and admins can moderate comments.' }, `/org/${request.params.id || org?.id}/admin/mod`);
    const removedComment = targetComment(org, request.params.commentId);
    const item = org.courses.flatMap((course) => course.items).find((entry) => entry.comments?.some((comment) => comment.id === request.params.commentId));
    const group = (org.groups || []).find((entry) => entry.comments?.some((comment) => comment.id === request.params.commentId));
    if (item) { item.comments = item.comments.filter((comment) => comment.id !== request.params.commentId); const course = org.courses.find((entry) => entry.items.includes(item)); emitCourse(org, course, 'item:comment-deleted', { itemId: item.id, commentId: request.params.commentId }); }
    if (group) { group.comments = group.comments.filter((comment) => comment.id !== request.params.commentId); emitGroup(org, 'breakout:comment-deleted', { groupId: group.id, commentId: request.params.commentId }); }
    if (removedComment?.userId && removedComment.userId !== request.user.id) addNotification?.(users.find((user) => user.id === removedComment.userId), { type: 'comment-removed', title: `Comment removed in ${org.name}`, message: 'A group administrator removed one of your comments for review.' });
    persistState();
    return sendMutation(request, response, { removed: Boolean(item || group), commentId: request.params.commentId }, `/org/${org.id}/admin/mod`);
  });

  app.post('/org/:id/admin/comments/:commentId/review', requireUser, (request, response) => {
    const org = getOrg(request); const target = findReportedComment(org, request.params.commentId);
    if (!org || !target || !isOrgModerator(org, request.user)) return sendMutation(request, response, { error: 'That comment is unavailable or you are not a moderator.' }, `/org/${request.params.id}/admin/mod`);
    target.comment.reviewedAt = new Date().toISOString(); target.comment.reviewedBy = request.user.id; persistState();
    return sendMutation(request, response, { reviewed: true, commentId: target.comment.id }, `/org/${org.id}/admin/mod`);
  });
}

function membershipRole(org, user) { return org?.members?.find((member) => member.userId === user?.id)?.role || 'viewer'; }

function targetComment(org, commentId) {
  for (const course of org.courses || []) for (const item of course.items || []) { const comment = (item.comments || []).find((entry) => entry.id === commentId); if (comment) return comment; }
  for (const group of org.groups || []) { const comment = (group.comments || []).find((entry) => entry.id === commentId); if (comment) return comment; }
  return null;
}

module.exports = { commentHistory, moderationComments, registerCommentRoutes };
