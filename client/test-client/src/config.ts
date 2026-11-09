// Runtime connection state for the test client. The token lives in
// sessionStorage (cleared with the tab), the base URL and last vdir in
// localStorage. Nothing is ever sent anywhere except the server the
// visitor names.

export type Connection = {
  baseUrl: string;
  token: string;
  vdir: string;
};

export type Stores = {
  local: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  session: Pick<Storage, "getItem" | "setItem" | "removeItem">;
};

const BASE_KEY = "sf-test-client.baseUrl";
const VDIR_KEY = "sf-test-client.vdir";
const TOKEN_KEY = "sf-test-client.token";

export function browserStores(): Stores {
  return { local: window.localStorage, session: window.sessionStorage };
}

export function loadConnection(stores: Stores = browserStores()): Connection {
  return {
    baseUrl: stores.local.getItem(BASE_KEY) ?? "",
    vdir: stores.local.getItem(VDIR_KEY) ?? "",
    token: stores.session.getItem(TOKEN_KEY) ?? "",
  };
}

export function saveConnection(
  connection: Connection,
  stores: Stores = browserStores(),
): void {
  setOrRemove(stores.local, BASE_KEY, connection.baseUrl.trim());
  setOrRemove(stores.local, VDIR_KEY, connection.vdir.trim());
  setOrRemove(stores.session, TOKEN_KEY, connection.token.trim());
}

export function clearToken(stores: Stores = browserStores()): void {
  stores.session.removeItem(TOKEN_KEY);
}

function setOrRemove(
  store: Stores["local"],
  key: string,
  value: string,
): void {
  if (value) store.setItem(key, value);
  else store.removeItem(key);
}
