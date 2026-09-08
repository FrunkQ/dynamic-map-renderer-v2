# "My player can't join" — what it means and what to do

Written for GMs and players, not for developers. If you want the technical
version, see `p2p-ice-verdict-crossrepo.md`.

---

## The one-paragraph version

Mappadux connects players straight to your computer, with no server in the
middle. That is what keeps it fast and private — but it means the two devices
have to find a route to each other through whatever routers, firewalls and
mobile networks are in the way. Usually they can. When they cannot, the fix is a
**relay**: a small server that both ends CAN reach, which passes the traffic
along. You add one once, in Settings, and it goes out in every link you share
from then on.

---

## For the GM

### How you know this is happening

Any of these:

- A player says they get **"P2P negotiation error"**, "connection blocked", or a
  screen that just never finishes loading.
- **Player Views > Player connections** shows *"1 player could not connect"*.
  Mappadux tells you this now — the player who sees the error cannot fix it, so
  the message is carried across to you.
- It works for players in your house and fails for players elsewhere.

### The fix, in order

1. **Open Settings > Connections.** If it says *"No relay configured"*, that is
   almost certainly the problem. Go to step 2. If a relay IS listed, press
   **Test these servers** — if that reports a working relay, skip to step 4.

2. **Get a relay.** You need a TURN server. Free tiers exist (search "free TURN
   server" — several managed providers offer one big enough for a gaming
   group), or you can run a small `coturn` yourself. You want an address on
   **port 443** starting `turns:` if you can get one: that is the form that
   crosses the most restrictive networks, including most workplaces.

   You will be given three things: an address, a username and a password.

3. **Paste it in.** Settings > Connections, one per line:

   ```
   turns:relay.example.com:443|myusername|mypassword
   ```

4. **Press "Test these servers".** This checks the relay is reachable and the
   credentials are right, before a game rather than during one. You want
   *"Relay working"*.

5. **Re-share your link or QR code.** This is the step people miss. The relay
   travels INSIDE the join link, so a player using an older link still has no
   relay. Any link you share from now on carries it; older ones do not.

### Why it has to work this way

A player who cannot connect cannot be sent a message — there is no connection to
send it down. So the relay has to be in the link before they open it. That is
also why re-sharing matters more than it sounds.

---

## For the player

### What the message means

Your device and your GM's computer could not find a route to each other. It is
not a fault with your device, your GM's computer, or Mappadux. It is the network
between you — most often a mobile network, a workplace or campus connection, or
a router that will not allow this kind of direct link.

### What to try, in order

1. **Switch between wi-fi and mobile data.** This is the single most effective
   thing you can do, and it takes ten seconds. Mobile networks and home wi-fi
   fail in different ways, so one often works when the other does not.

2. **Turn off any VPN or private-relay feature**, including iCloud Private Relay
   and browser VPN extensions. These frequently block this kind of connection.

3. **Try a different browser.** Chrome and Edge tend to find a route in
   situations where others do not. If Chrome works and another browser does not,
   that is not you doing anything wrong — see the note below.

4. **Tell your GM.** They have already been told by Mappadux, but say so anyway,
   and ask them for a **new link** once they have added a relay. An old link
   will not pick it up.

### If it works in Chrome but not Firefox

That is a known and understood difference, not a fault on your part. Where there
is no relay, the browsers are left to find a direct route on their own, and they
do not all try the same things — Chrome is more persistent about it, especially
on mobile networks. Once your GM adds a relay, both should work.

---

## What we changed after this came up (2026-09-08)

A player reported exactly this: fine on Chrome for Android, "P2P negotiation
error" on Firefox for Android. Three things came out of it:

1. **The error was misleading.** It said "negotiation", which sounds like the two
   ends disagreed about something. They did not — no network route was found.
   The message now says that.
2. **The GM was never told.** A player whose connection fails never appears at
   all, so a GM had no way of knowing anyone had tried. Now they are told, in
   the Player connections panel, along with which fix applies.
3. **The built-in fallback relay was dead.** The shared relay that ships with the
   underlying library no longer exists — its addresses stopped resolving. So
   "no relay configured" quietly meant "no relay at all, for anyone". The
   Settings text used to claim otherwise; it does not any more, and the new
   **Test these servers** button will tell you the truth about any relay in
   about five seconds.
