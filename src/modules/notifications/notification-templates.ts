/** The text of each message the system sends. Dates and money arrive already written for people. */
export interface TemplateData {
  PASSWORD_RESET: {
    name: string;
    resetUrl: string;
    expiresInMinutes: number;
    institutionName: string | null;
  };
  VOUCHER_ISSUED: {
    guardianName: string;
    studentName: string;
    monthLabel: string;
    amount: string;
    dueDate: string;
    institutionName: string;
  };
  VOUCHER_OVERDUE: {
    guardianName: string;
    studentName: string;
    monthLabel: string;
    amountDue: string;
    dueDate: string;
    institutionName: string;
  };
  RESULT_PUBLISHED: {
    guardianName: string;
    studentName: string;
    examName: string;
    institutionName: string;
  };
  ABSENCE_ALERT: {
    guardianName: string;
    studentName: string;
    date: string;
    institutionName: string;
  };
  TRIAL_EXPIRING: {
    adminName: string;
    institutionName: string;
    daysLeft: number;
    endsOn: string;
  };
  BACKUP_ALERT: {
    jobName: string;
    reason: string;
    at: string;
  };
  BACKUP_REPORT: {
    date: string;
    /** One line per fact, already written for people. */
    lines: string[];
    healthy: boolean;
  };
}

export type TemplateKey = keyof TemplateData;

export interface RenderedMessage {
  subject: string;
  text: string;
  html: string;
}

/** Makes text safe to place inside HTML, so a name can never add markup. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Only web links go into a button: anything else (`javascript:`) is dropped. */
function safeLink(url: string): string | null {
  return /^https?:\/\//i.test(url) ? url : null;
}

interface Layout {
  heading: string;
  paragraphs: string[];
  button?: { label: string; url: string };
  footer?: string;
}

/** Plain text and HTML for the same content, so both always say the same thing. */
function compose(layout: Layout): { text: string; html: string } {
  const link = layout.button ? safeLink(layout.button.url) : null;
  const textParts = [layout.heading, '', ...layout.paragraphs];
  if (layout.button && link) {
    textParts.push('', `${layout.button.label}: ${link}`);
  }
  if (layout.footer) textParts.push('', layout.footer);
  const htmlParts = [
    `<h2 style="margin:0 0 16px;font-family:Arial,sans-serif">${escapeHtml(layout.heading)}</h2>`,
    ...layout.paragraphs.map(
      (paragraph) =>
        `<p style="margin:0 0 12px;font-family:Arial,sans-serif;line-height:1.5">${escapeHtml(paragraph)}</p>`,
    ),
  ];
  if (layout.button && link) {
    htmlParts.push(
      `<p style="margin:20px 0"><a href="${escapeHtml(link)}" style="background:#1a237e;color:#ffffff;padding:10px 18px;border-radius:6px;text-decoration:none;font-family:Arial,sans-serif">${escapeHtml(layout.button.label)}</a></p>`,
      `<p style="margin:0 0 12px;font-family:Arial,sans-serif;color:#555555;font-size:12px">If the button does not work, copy this address into your browser: ${escapeHtml(link)}</p>`,
    );
  }
  if (layout.footer) {
    htmlParts.push(
      `<p style="margin:16px 0 0;font-family:Arial,sans-serif;color:#555555;font-size:12px">${escapeHtml(layout.footer)}</p>`,
    );
  }
  return { text: textParts.join('\n'), html: htmlParts.join('\n') };
}

const RENDERERS: {
  [K in TemplateKey]: (data: TemplateData[K]) => RenderedMessage;
} = {
  PASSWORD_RESET: (data) => ({
    subject: 'Reset your Nexus password',
    ...compose({
      heading: 'Reset your password',
      paragraphs: [
        `Hello ${data.name},`,
        `We received a request to reset the password for your account${data.institutionName ? ` at ${data.institutionName}` : ''}. This link works for ${data.expiresInMinutes} minutes and can be used once.`,
      ],
      button: { label: 'Choose a new password', url: data.resetUrl },
      footer:
        'If you did not ask for this, you can ignore this message; your password will not change.',
    }),
  }),
  VOUCHER_ISSUED: (data) => ({
    subject: `Fee voucher for ${data.studentName}, ${data.monthLabel}`,
    ...compose({
      heading: 'A fee voucher has been issued',
      paragraphs: [
        `Dear ${data.guardianName},`,
        `${data.institutionName} has issued the fee voucher for ${data.studentName} for ${data.monthLabel}. The amount is ${data.amount}, due by ${data.dueDate}.`,
      ],
    }),
  }),
  VOUCHER_OVERDUE: (data) => ({
    subject: `Fee reminder for ${data.studentName}, ${data.monthLabel}`,
    ...compose({
      heading: 'A fee payment is overdue',
      paragraphs: [
        `Dear ${data.guardianName},`,
        `The fee for ${data.studentName} for ${data.monthLabel} was due on ${data.dueDate} and ${data.amountDue} is still unpaid. Please pay at the school or contact ${data.institutionName}.`,
      ],
    }),
  }),
  RESULT_PUBLISHED: (data) => ({
    subject: `${data.examName} results for ${data.studentName}`,
    ...compose({
      heading: 'Results are published',
      paragraphs: [
        `Dear ${data.guardianName},`,
        `${data.institutionName} has published the results of ${data.examName} for ${data.studentName}. Sign in to Nexus to see them.`,
      ],
    }),
  }),
  ABSENCE_ALERT: (data) => ({
    subject: `${data.studentName} was marked absent on ${data.date}`,
    ...compose({
      heading: 'Absence notice',
      paragraphs: [
        `Dear ${data.guardianName},`,
        `${data.studentName} was marked absent at ${data.institutionName} on ${data.date}. If this is a mistake, please contact the school.`,
      ],
    }),
  }),
  TRIAL_EXPIRING: (data) => ({
    subject: `Your Nexus trial ends on ${data.endsOn}`,
    ...compose({
      heading: 'Your trial is ending',
      paragraphs: [
        `Hello ${data.adminName},`,
        `The free trial for ${data.institutionName} ends on ${data.endsOn}, in ${data.daysLeft} day${data.daysLeft === 1 ? '' : 's'}. Choose a plan before then to keep every module.`,
      ],
    }),
  }),
  BACKUP_ALERT: (data) => ({
    subject: `Nexus backup problem: ${data.jobName}`,
    ...compose({
      heading: 'A backup did not complete',
      paragraphs: [
        `The ${data.jobName} step failed at ${data.at}.`,
        `Reason: ${data.reason}`,
        'The next scheduled run will try again, but please look at this today.',
      ],
    }),
  }),
  BACKUP_REPORT: (data) => ({
    subject: `Nexus backups, ${data.date}: ${data.healthy ? 'all well' : 'needs attention'}`,
    ...compose({
      heading: data.healthy
        ? 'Backups are running normally'
        : 'Backups need attention',
      paragraphs: data.lines,
    }),
  }),
};

/**
 * Writes a message from a template and its data.
 *
 * @param {TemplateKey} key - Which message.
 * @param {TemplateData[K]} data - What to put in it.
 * @returns {RenderedMessage} Subject, plain text and HTML.
 */
export function renderTemplate<K extends TemplateKey>(
  key: K,
  data: TemplateData[K],
): RenderedMessage {
  return RENDERERS[key](data);
}
