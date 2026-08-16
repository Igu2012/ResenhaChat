export type InvitableContact = { id: string; connectionCode: string };

export function filterInvitableContacts<T extends InvitableContact>(contacts: T[], memberIds: Iterable<string>): T[] {
  const members = new Set(memberIds);
  return contacts.filter(contact => !members.has(contact.id));
}
