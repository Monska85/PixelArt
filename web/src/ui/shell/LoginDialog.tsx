// SPDX-License-Identifier: GPL-3.0-or-later

import { useState } from "react";
import { isToken } from "../../protocol";
import { Button } from "../components/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../components/dialog";
import { Input } from "../components/input";
import { Field } from "../common/Field";
import { TOKEN_LOGIN_NOTE } from "../privacy";
import { session, useSession } from "../session";

/** Asks for the board's token when a board over WiFi wants a login and the browser has none for it. */
export function LoginDialog() {
  const { loginRequest } = useSession();
  return loginRequest ? <TokenForm host={loginRequest.host} /> : null;
}

function TokenForm({ host }: { host: string }) {
  const [token, setToken] = useState("");
  const valid = isToken(token);
  const problem = token !== "" && !valid ? "The token is 16 characters, lowercase letters and digits." : null;
  return (
    <Dialog open onOpenChange={(open) => !open && session.cancelLogin()}>
      <DialogContent aria-describedby={undefined}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid) session.submitToken(token);
          }}
        >
          <DialogHeader>
            <DialogTitle>Log in to the board</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            The board at <span className="break-all font-mono">{host}</span> has network login on. Enter its token: the
            Network access card shows it when the board is connected over USB.
          </p>
          <p className="text-xs text-muted-foreground" data-testid="token-login-privacy">
            {TOKEN_LOGIN_NOTE}
          </p>
          <Field label="Token" error={problem}>
            {(control) => (
              <Input
                {...control}
                type="password"
                name="pixelart-token"
                value={token}
                autoFocus
                autoComplete="off"
                spellCheck={false}
                maxLength={16}
                className="font-mono"
                onChange={(e) => setToken(e.target.value.trim())}
              />
            )}
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => session.cancelLogin()}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid}>
              Log in
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
