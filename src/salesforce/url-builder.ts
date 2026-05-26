// Build a Salesforce Lightning URL that opens "New Task" with prefilled fields.
// Validated 2026-05-25 against overwolf.lightning.force.com — produces a record
// visually and functionally equivalent to a manually-logged "Log a Call → Discord" entry.

export interface BuildSFTaskUrlInput {
  sfDomain: string;
  subject: string;
  description: string;
  whatId: string;
  activityDate: string;
}

export function buildSFTaskUrl(input: BuildSFTaskUrlInput): string {
  const fields = {
    Subject: input.subject,
    Description: input.description,
    WhatId: input.whatId,
    Status: 'Completed',
    ActivityDate: input.activityDate
  };

  const inner = Object.entries(fields)
    .map(([k, v]) => `${k}=${v}`)
    .join(',');

  const url = new URL(`https://${input.sfDomain}/lightning/o/Task/new`);
  url.searchParams.set('defaultFieldValues', inner);
  return url.toString();
}
