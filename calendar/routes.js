const express = require('express');

function monthItems(items, year, month) {
  const targetMonth = `${year}-${String(month).padStart(2, '0')}`;
  return items.filter((entry) =>
    /^\d{4}-\d{2}-\d{2}$/.test(entry.due || '') && entry.due.startsWith(targetMonth)
  );
}

module.exports = function createCalendarRouter({ requireUser, render, allItems }) {
  const router = express.Router();

  function renderMonth(request, response, year, month) {
    return render(request, response, 'calendar', {
      calendarItems: monthItems(allItems(), year, month),
      calendarYear: year,
      calendarMonth: month
    });
  }

  router.get('/', requireUser, (request, response) => {
    const now = new Date();
    return renderMonth(request, response, now.getFullYear(), now.getMonth() + 1);
  });

  router.get('/:year/:month', requireUser, (request, response) => {
    const year = Number(request.params.year);
    const month = Number(request.params.month);
    if (!/^\d{4}$/.test(request.params.year) || !Number.isInteger(year) || year < 1 || month < 1 || month > 12) {
      return response.sendStatus(404);
    }
    return renderMonth(request, response, year, month);
  });

  return router;
};
