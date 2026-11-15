import { expect, request, test } from "@playwright/test";

// Two real origins: the test client (baseURL) and the Stratofold stack.
// Setup uses a separate API context so the browser context starts with
// no cookies at all — the cross-origin flows must work from the header
// alone.
const API = process.env.SF_E2E_API_URL ?? "http://127.0.0.1:8090";
const OWNER = {
  identity: "owner@stratofold.test",
  password: "owner-pass-123",
};

type Vdir = { id: string; name: string; is_public: boolean };

test.describe.configure({ mode: "serial" });

test("the client works from a foreign origin against a real vdir", async ({
  page,
}) => {
  const admin = await request.newContext({ baseURL: API });

  // Resolve the seeded private and public vdirs through the record API.
  const auth = await admin.post("/api/collections/users/auth-with-password", {
    data: OWNER,
  });
  expect(auth.ok()).toBeTruthy();
  const authBody = (await auth.json()) as { token: string };
  const vdirsResp = await admin.get(
    "/api/collections/vdirs/records?perPage=50",
    { headers: { Authorization: authBody.token } },
  );
  expect(vdirsResp.ok()).toBeTruthy();
  const vdirs = (await vdirsResp.json()) as { items: Vdir[] };
  const privateVdir = vdirs.items.find((vdir) => !vdir.is_public);
  const publicVdir = vdirs.items.find((vdir) => vdir.is_public);
  expect(privateVdir).toBeDefined();
  expect(publicVdir).toBeDefined();

  // The session cookie drives minting; keep it in the admin context.
  const session = await admin.post("/api/sf/auth", { data: OWNER });
  expect(session.ok()).toBeTruthy();
  const mint = await admin.post("/api/sf/tokens", {
    data: { vdir: privateVdir!.id, name: "client-e2e", role: "editor" },
  });
  expect(mint.ok()).toBeTruthy();
  const minted = (await mint.json()) as {
    token: string;
    connection_string: string;
  };
  const token = minted.token;
  const connectionString = minted.connection_string;
  expect(token).toMatch(/^sf_v1_/);
  expect(connectionString).toMatch(/^sfconn_v1_/);

  const urls: string[] = [];
  page.on("request", (req) => urls.push(req.url()));

  await page.goto("/");

  // A pasted connection string fills the server, vdir, and token in one
  // step; the package parses it locally and the field is cleared.
  await page.fill("#connectionString", connectionString);
  await page.click("#applyConnectionString");
  await expect(page.locator("#baseUrl")).toHaveValue(
    API.replace(/\/+$/, ""),
  );
  await expect(page.locator("#vdir")).toHaveValue(privateVdir!.id);
  await expect(page.locator("#connectionString")).toHaveValue("");

  // Scope discovery sets the vdir from the token alone.
  await page.click("#discover");
  await expect(page.locator("#vdir")).toHaveValue(privateVdir!.id);
  await expect(page.locator("#log")).toContainText(`vdir ${privateVdir!.name}`);

  // Listing.
  await page.fill("#path", "");
  await page.click("#list");
  await expect(page.locator("#log")).toContainText("hello.txt");
  await expect(page.locator("#log")).toContainText("docs");

  // Upload (cross-origin preflighted request).
  await page.setInputFiles("#uploadFile", {
    name: "e2e-upload.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("client e2e"),
  });
  await page.fill("#uploadPath", "e2e-upload.txt");
  await page.click("#upload");
  await expect(page.locator("#log")).toContainText(
    "upload e2e-upload.txt: 10 byte(s)",
  );

  // Range read exercises the file-server bearer path + exposed headers.
  await page.fill("#path", "e2e-upload.txt");
  await page.fill("#range", "bytes=0-4");
  await page.click("#read");
  await expect(page.locator("#log")).toContainText("HTTP 206");
  await expect(page.locator("#log")).toContainText("bytes 0-4/10");

  // Plain URL carries no credential.
  await page.click("#fileUrl");
  await expect(page.locator("#log")).toContainText(
    `${API}/files/${privateVdir!.id}/e2e-upload.txt`,
  );

  // Temporary link is absolute, session-free, and redeemable cookieless.
  await page.click("#temporaryUrl");
  const link = page.locator("#log a").last();
  await expect(link).toHaveAttribute("href", /\/s\//);
  const temporaryUrl = await link.getAttribute("href");
  expect(temporaryUrl).not.toContain(token);

  const cookieless = await request.newContext();
  const redeemed = await cookieless.get(temporaryUrl!);
  expect(redeemed.status()).toBe(200);
  expect(await redeemed.text()).toBe("client e2e");
  await cookieless.dispose();

  // Mutations: mkdir, move, remove.
  await page.fill("#path", "e2e-dir");
  await page.click("#mkdir");
  await expect(page.locator("#log")).toContainText("mkdir e2e-dir: done");

  await page.fill("#moveFrom", "e2e-upload.txt");
  await page.fill("#moveTo", "e2e-dir/moved.txt");
  await page.click("#move");
  await expect(page.locator("#log")).toContainText(
    "move e2e-upload.txt -> e2e-dir/moved.txt: done",
  );

  await page.fill("#path", "e2e-dir");
  await page.click("#remove");
  await expect(page.locator("#log")).toContainText("remove e2e-dir: done");

  // Public mode: no token, listing and reading still work.
  await page.click("#clearLog");
  await page.fill("#token", "");
  await page.fill("#vdir", publicVdir!.id);
  await page.fill("#baseUrl", API);
  await page.click("#save");
  await expect(page.locator("#temporaryUrl")).toBeDisabled();
  await expect(page.locator("#discover")).toBeDisabled();

  await page.fill("#path", "");
  await page.click("#list");
  await expect(page.locator("#log")).toContainText("index.html");

  await page.fill("#path", "hello.txt");
  await page.fill("#range", "");
  await page.click("#read");
  await expect(page.locator("#log")).toContainText("read hello.txt: HTTP 200");

  // Neither the connection string nor the bearer token appears in any
  // request URL.
  expect(urls.some((url) => url.includes(connectionString))).toBe(false);
  expect(urls.some((url) => url.includes(token))).toBe(false);

  await admin.dispose();
});
