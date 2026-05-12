update reminders
set
  confirmation_required = false,
  time_text = to_char(remind_at at time zone 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI'),
  reason = '已按确认时间设置提醒：' || to_char(remind_at at time zone 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI') || '。'
where status in ('confirmed', 'scheduled', 'sent', 'done', 'cancelled', 'expired')
  and remind_at is not null;
