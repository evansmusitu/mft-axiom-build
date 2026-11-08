/** Contract placeholder, not an external email transport. */
export function createMailFabricAdapter() {
  return Object.freeze({enabled:false,send(){throw new Error('MAIL_FABRIC_RELEASE_NOT_AUTHORIZED');}});
}
