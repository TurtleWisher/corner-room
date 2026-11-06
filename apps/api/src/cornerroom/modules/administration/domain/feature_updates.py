"""Corner Room's feature updates log (owner, 2026-11-06, D-UPDATES-01). Staff only.

Every feature of Corner Room, what it does today, and each update to it in date order: when it
came (NEW), when it got better (IMPROVED) and every fix (FIXED). Written from the work as it
ships, never typed in the console: **each change that ships adds its line here**, under its
feature (or a new feature). Dates are the day the change was made (Asia/Dhaka). Plain words for
staff; no server details, secrets or people's data (this repository is public).
"""

from __future__ import annotations

from typing import Final

UPDATE_KINDS: Final = ("NEW", "IMPROVED", "FIXED")
AREAS: Final = ("Music", "Listening", "Events", "Money", "Artists", "Fans", "Staff", "Platform")

FEATURES: Final[list[dict]] = [
    {
        "id": "music-gifts",
        "name": "Music gifts",
        "area": "Artists",
        "audience": ["Artists", "Fans", "Staff"],
        "summary": "Artists give songs and releases free to chosen people by email, with no payment pages.",
        "description": (
            "In Studio > Gifts > Music gifts an artist or band picks released music, lists the people "
            "(email, an optional name and a personal note each; typed, pasted as a list or added from "
            "their buyers), writes the email with fill-ins and links, adds files or links and can choose "
            "a sending time. Staff approve every gift on Catalog > Releases. People with an account own "
            "the music at once (a free order, never money); an address without an account gets an email "
            "and the music as soon as it becomes a verified account. Studio shows who has it, who is "
            "still to sign up, and email delivery and link clicks."
        ),
        "updates": [
            {
                "date": "2026-11-06",
                "kind": "NEW",
                "title": "Music gifts for artists",
                "details": (
                    "Set up, staff review, scheduled sending, test email, copy a gift, per-person notes, "
                    "add buyers by name, files with the email, and a per-person report."
                ),
            },
        ],
    },
    {
        "id": "feature-updates-log",
        "name": "Feature updates log",
        "area": "Staff",
        "audience": ["Staff"],
        "summary": "This page: every Corner Room feature with its updates and fixes, for staff only.",
        "description": (
            "Staff > Admin > Feature updates lists each feature, what it does today and every update to "
            "it, newest first, with search and filters by area and kind of change. Only signed-in staff "
            "can open it; the list comes from the server, not the public site."
        ),
        "updates": [
            {"date": "2026-11-06", "kind": "NEW", "title": "Feature updates log for staff", "details": "Filled with the history of every feature so far."},
        ],
    },
    {
        "id": "presales",
        "name": "Pre-sales",
        "area": "Music",
        "audience": ["Fans", "Artists", "Staff"],
        "summary": "Sell music before release day; buyers get it the moment it comes out.",
        "description": (
            "An artist proposes a pre-sale price and date in Studio, even before the music is finished; "
            "staff approve the title, artist, date and price. Fans see a Pre-book button, the release "
            "time and what they get, with the cover hidden until release unless the artist reveals it "
            "early. On release day the music unlocks, buyers are told, and a release-day email from the "
            "artist goes out. Staff can move the date (buyers are emailed), release early, send music "
            "back to pre-sale, or cancel with full refunds. Each pre-sale has its own Studio campaign "
            "pages with live numbers and share links. Buyers who paid before Corner Room launched get "
            "their music when their email is verified."
        ),
        "updates": [
            {"date": "2026-11-07", "kind": "FIXED", "title": "Numbers fit the page", "details": "Long site names wrap inside their card instead of being cut off at the right edge."},
            {"date": "2026-11-06", "kind": "NEW", "title": "Pre-sale campaigns in Studio", "details": "Live numbers, set-up, fan page and named share links per pre-sale; numbers carry on after release."},
            {"date": "2026-11-03", "kind": "NEW", "title": "Pre-sales in the fan Store", "details": "An \"On pre-sale\" group first in the Store, on Releases and on artist profiles."},
            {"date": "2026-11-03", "kind": "NEW", "title": "Back to pre-sale", "details": "Music released before its pre-sale date can go back to pre-sale; Release now asks first."},
            {"date": "2026-11-03", "kind": "IMPROVED", "title": "One clear price label", "details": "The Pre-sale section shows one price label; the badge and type read as two words."},
            {"date": "2026-11-03", "kind": "NEW", "title": "Early pre-sale", "details": "Start a pre-sale before the music is finished, with the full pre-sale experience for fans."},
            {"date": "2026-11-02", "kind": "NEW", "title": "Hidden covers until release", "details": "Pre-sale covers stay hidden until release, or until the artist reveals them early."},
            {"date": "2026-10-29", "kind": "NEW", "title": "Pre-orders on Corner Room", "details": "Pre-order before release, automatic release day, cancel with full refunds."},
            {"date": "2026-10-27", "kind": "IMPROVED", "title": "Pre-sale buyers' contact details", "details": "Phone and address kept for the staff customer list."},
            {"date": "2026-10-25", "kind": "NEW", "title": "Free pre-sale gifts", "details": "A ৳0 pre-sale gift gets the song and counts as a sale with no payment."},
            {"date": "2026-10-25", "kind": "FIXED", "title": "Late buyers were never claimed", "details": "The tests now drain every waiting event, so a late buyer's verification is reached."},
            {"date": "2026-10-25", "kind": "NEW", "title": "Buyers from before launch", "details": "People who paid before launch get the song when their email is verified; each claim becomes a normal order."},
        ],
    },
    {
        "id": "artist-emails",
        "name": "Artist emails",
        "area": "Artists",
        "audience": ["Artists", "Fans", "Staff"],
        "summary": "Artists thank buyers and write to them; staff approve each email.",
        "description": (
            "Studio > Gifts > Emails. Thank-you emails go out on every purchase, in versions per audience "
            "(the most specific one sends). Emails to buyers use filters and ticking people in or out, "
            "occasion starters, fill-ins shown as the buyer's real words, links, files, templates and an "
            "optional sending time; staff approve each one. Every email is HTML with a plain-text copy, "
            "counts link clicks (no open tracking) and carries a one-click stop link."
        ),
        "updates": [
            {"date": "2026-11-02", "kind": "NEW", "title": "Artist email studio", "details": "Thank-yous per audience, real-name editor with links, smart audiences, scheduling, click reports and gift files."},
            {"date": "2026-11-02", "kind": "FIXED", "title": "Scheduled emails job listed", "details": "The scheduled artist email job now runs with the other worker jobs."},
            {"date": "2026-11-02", "kind": "NEW", "title": "Artist emails", "details": "Thank-you on purchase, emails to buyers that staff approve, templates and stop links."},
        ],
    },
    {
        "id": "gift-campaigns",
        "name": "Gift campaigns",
        "area": "Artists",
        "audience": ["Artists", "Fans", "Staff"],
        "summary": "Free extras (posters, stickers) for the people who buy an artist's music.",
        "description": (
            "An artist or band sets up a gift for buyers of chosen music; staff review it and every "
            "change. It can be paused and restarted any time. Each collectible is tracked as not prepared, "
            "prepared, dispatched (now or at a chosen time), received, returned or missing, by the artist "
            "when they send it and always by staff, with one click to mark everyone prepared. Dispatching "
            "tells each buyer by email that it is on its way; returned and missing tell them too. A "
            "release's numbers page shows its collectibles. Music given free through a music gift doesn't "
            "earn a campaign gift."
        ),
        "updates": [
            {"date": "2026-11-07", "kind": "NEW", "title": "Add people by hand", "details": "Add buyers who paid outside Corner Room, typed in, pasted from a sheet or from a .csv file; the act's additions wait for staff."},
            {"date": "2026-11-06", "kind": "IMPROVED", "title": "Collectible tracking", "details": "Prepared, dispatched now or later, received, returned and missing; mark all prepared in one click."},
            {"date": "2026-11-06", "kind": "NEW", "title": "Collectibles on release numbers", "details": "A release's numbers page shows how far each of its collectibles has got."},
            {"date": "2026-11-06", "kind": "IMPROVED", "title": "Given music doesn't count", "details": "Music an artist gave away through a music gift doesn't earn a campaign gift."},
            {"date": "2026-10-28", "kind": "NEW", "title": "Gift campaigns", "details": "Artists set up gifts for buyers, staff review, tracking and dispatch emails."},
        ],
    },
    {
        "id": "store-and-catalog",
        "name": "Music catalog and Store",
        "area": "Music",
        "audience": ["Fans", "Artists"],
        "summary": "Songs and releases sold one by one; no subscriptions or catalog pass.",
        "description": (
            "Music is sold per song and per release in taka. Release pages have one buy button; songs on "
            "an album say \"Buy the album\". The Store and home list only music that is out, and pre-sale "
            "prices only while a pre-sale is open. Artists can delete music that isn't out yet and hasn't "
            "been bought."
        ),
        "updates": [
            {"date": "2026-11-03", "kind": "IMPROVED", "title": "Only music that is out", "details": "The Store lists only released music; checkout refuses songs that aren't out."},
            {"date": "2026-11-03", "kind": "NEW", "title": "Delete release", "details": "Remove a release that isn't out yet, with its songs, prices and waiting reviews."},
            {"date": "2026-11-01", "kind": "IMPROVED", "title": "Albums and singles on Listen", "details": "Hover-focus lists and glass artist cards."},
            {"date": "2026-10-30", "kind": "FIXED", "title": "\"Not on sale yet\"", "details": "Fixed the wrong label; the Tracks tab groups songs by album; album songs say \"Buy the album\"."},
            {"date": "2026-10-25", "kind": "IMPROVED", "title": "One buy button", "details": "Release page has one buy button; song rows show a quiet lock instead of a second price."},
            {"date": "2026-10-25", "kind": "IMPROVED", "title": "New Store line", "details": "Launch labels: Beta beside the header logo and a new Store line."},
            {"date": "2026-10-24", "kind": "IMPROVED", "title": "Public music details", "details": "Public music pages with sign-in and lock buttons; subscriptions and the catalog pass removed."},
            {"date": "2026-09-11", "kind": "NEW", "title": "Music catalog", "details": "Tracks, releases and versions in the first platform build."},
        ],
    },
    {
        "id": "audio-streaming",
        "name": "Audio, streaming and offline",
        "area": "Listening",
        "audience": ["Fans", "Artists", "Staff"],
        "summary": "High-quality playback that keeps playing across pages, and offline saving.",
        "description": (
            "Uploaded masters are processed into Opus 160 and MP3 320 playback copies. The player lives "
            "above every page, so music never stops on a page change, and its bar steps aside while you "
            "read. Bought songs can be saved in the browser and played with no connection. Staff and the "
            "music's own artist listen without buying."
        ),
        "updates": [
            {"date": "2026-11-01", "kind": "IMPROVED", "title": "Player bar follows the scroll", "details": "Fades away while reading down and comes back on scrolling up."},
            {"date": "2026-10-30", "kind": "IMPROVED", "title": "Listen without buying", "details": "Staff and the music's own artist or band listen without buying."},
            {"date": "2026-10-28", "kind": "IMPROVED", "title": "Music keeps playing", "details": "Music keeps playing on every page; MP3 320 streams; Normalise off by default; glossier buttons."},
            {"date": "2026-10-25", "kind": "NEW", "title": "Offline saving", "details": "Opus 160 and MP3 320 playback switched on; bought songs save offline with an offline player."},
            {"date": "2026-10-18", "kind": "NEW", "title": "Audio platform", "details": "Uploads, processing and playback copies."},
        ],
    },
    {
        "id": "listening-room",
        "name": "Listening room",
        "area": "Listening",
        "audience": ["Fans"],
        "summary": "The full-screen place to listen, with the cover, lyrics and controls.",
        "description": (
            "Play opens the listening room: a full-screen view with the blurred cover, a carousel, and the "
            "lyrics on a ring round the cover that follow the song when staff have timed them. Lyrics are on "
            "from the start, with a Lyrics switch under the close button (beside it on phones); turning them "
            "off is remembered on that device. The room is one still screen that fits the window without "
            "scrolling, and a double-click on empty space goes properly full screen (the same again comes "
            "out). The big "
            "title links to the song page. When the browser blocks the automatic start, the room shows the "
            "song's real length and a lit play key."
        ),
        "updates": [
            {"date": "2026-11-07", "kind": "FIXED", "title": "One still screen", "details": "The room no longer scrolls or jumps as lyrics move; cover, title and bar always fit the window."},
            {"date": "2026-11-07", "kind": "IMPROVED", "title": "Full screen on double-click", "details": "Double-click empty space for full screen and again to leave; buttons never trigger it."},
            {"date": "2026-11-06", "kind": "IMPROVED", "title": "Lyrics on from the start", "details": "A Lyrics switch under the close button; turning lyrics off is remembered on the device."},
            {"date": "2026-11-06", "kind": "IMPROVED", "title": "Full screen room", "details": "The room fills the window, and the first click in it goes properly full screen."},
            {"date": "2026-11-02", "kind": "IMPROVED", "title": "Room bar polish", "details": "Save and playlist buttons get the glossy hover; the playlist panel is solid."},
            {"date": "2026-11-02", "kind": "FIXED", "title": "Before the first click", "details": "Real length, short status and a lit play key; title link on the not-owned screen."},
            {"date": "2026-11-02", "kind": "NEW", "title": "Timed lyrics and title link", "details": "Staff tap along once per line and the room follows; the room title links to the song page."},
            {"date": "2026-11-01", "kind": "IMPROVED", "title": "Play opens the room", "details": "A single shows its song's credits instead of a second Play."},
            {"date": "2026-11-01", "kind": "IMPROVED", "title": "Lyrics round the cover", "details": "Lyrics on a ring round the cover, first as 3D smoke."},
            {"date": "2026-10-31", "kind": "IMPROVED", "title": "Room transition", "details": "Smoother way into the listening room."},
            {"date": "2026-10-28", "kind": "NEW", "title": "Floating lyrics", "details": "Lyrics float in the room."},
            {"date": "2026-10-27", "kind": "FIXED", "title": "Fans' room reports", "details": "Fixes from fans' reports on the listening room."},
            {"date": "2026-10-14", "kind": "NEW", "title": "Listening room", "details": "Full-screen carousel, blurred cover, focus view with edge reveal."},
        ],
    },
    {
        "id": "song-page-listens",
        "name": "Song page and listens",
        "area": "Listening",
        "audience": ["Fans", "Artists"],
        "summary": "Each song's page with its credits, lyrics and counted listens.",
        "description": (
            "Every counted listen is recorded once; staff and artist plays don't count, and plays before "
            "counting started are kept apart. The song page draws its listens very large behind the cover "
            "as an exact fraction of a million, with the exact count beside the cover."
        ),
        "updates": [
            {"date": "2026-11-02", "kind": "NEW", "title": "Listens in millions", "details": "Very large behind the cover, digits rolling into place."},
            {"date": "2026-10-31", "kind": "IMPROVED", "title": "Song page motion", "details": "Calmer movement on the song page."},
            {"date": "2026-10-30", "kind": "FIXED", "title": "Staff and artist plays", "details": "They no longer count as listens."},
            {"date": "2026-10-28", "kind": "NEW", "title": "Listen counts and new song page", "details": "Listen counts, earlier plays, and a new song page."},
        ],
    },
    {
        "id": "lyrics",
        "name": "Lyrics",
        "area": "Music",
        "audience": ["Artists", "Fans", "Staff"],
        "summary": "Artists add lyrics, staff review them, and staff can time each line.",
        "description": (
            "Artists add song lyrics in Studio; staff review them and later changes. Staff open the timing "
            "page, play the released song and tap Space as each line starts, so the listening room follows "
            "the song. Times are dropped if the number of sung lines changes."
        ),
        "updates": [
            {"date": "2026-11-02", "kind": "NEW", "title": "Timed lyrics", "details": "Staff tap along once per line."},
            {"date": "2026-10-28", "kind": "NEW", "title": "Lyrics with staff review", "details": "Song lyrics and lyrics changes waiting for staff."},
        ],
    },
    {
        "id": "credits",
        "name": "Song credits",
        "area": "Music",
        "audience": ["Artists", "Fans"],
        "summary": "Who wrote, played and produced each song, shown on the song page.",
        "description": (
            "Artists credit people by typed name or by linked profile, with instruments, and drag them "
            "into order (a new order goes live with no review). Musicians fold under the act they played "
            "in, and profiles list where they are credited."
        ),
        "updates": [
            {"date": "2026-10-31", "kind": "FIXED", "title": "Fold under the song's own artist", "details": "Musicians always fold under the song's own artist, unless Studio names another act."},
            {"date": "2026-10-31", "kind": "IMPROVED", "title": "Clearer credits", "details": "Musicians fold under their act, Credited on for profiles, clearer editor with profile search."},
            {"date": "2026-10-31", "kind": "FIXED", "title": "Drag keeps the pointer", "details": "Rows slide aside and the drop reorders; keyboard moves keep focus."},
            {"date": "2026-10-31", "kind": "NEW", "title": "Drag to reorder", "details": "Artists drag song credits into a new order; it goes live with no review."},
            {"date": "2026-10-30", "kind": "FIXED", "title": "Credits help text", "details": "No bare quotes in the Studio credits help."},
            {"date": "2026-10-29", "kind": "FIXED", "title": "\"Artist not available\"", "details": "No longer shown for credited artists."},
            {"date": "2026-10-27", "kind": "IMPROVED", "title": "Typed names and instruments", "details": "Public credits show typed names and instruments."},
        ],
    },
    {
        "id": "artists-bands",
        "name": "Artists, bands and teams",
        "area": "Artists",
        "audience": ["Artists", "Fans", "Staff"],
        "summary": "One artist system for solo artists and bands, with owners and managers.",
        "description": (
            "Solo artists and bands are one kind of profile, each with an owner and managers. Profile "
            "changes and pictures wait for staff. Owners can hand a profile to an approved manager. Band "
            "members are listed by name. Fans follow artists and see their releases and pre-sales."
        ),
        "updates": [
            {"date": "2026-10-31", "kind": "NEW", "title": "Hand over a profile", "details": "The owner hands a profile to an approved manager; Team icon."},
            {"date": "2026-10-31", "kind": "NEW", "title": "One artist system", "details": "Solo artists and bands share one system; linked credit names."},
            {"date": "2026-10-30", "kind": "IMPROVED", "title": "Friendlier Studio", "details": "Artists see buyers' names; glass artist cards."},
            {"date": "2026-10-28", "kind": "NEW", "title": "Band members fold-out", "details": "Band members listed by typed name."},
            {"date": "2026-10-27", "kind": "IMPROVED", "title": "Bands", "details": "Band admins, band or solo, move to band; follow state and counts fixed."},
            {"date": "2026-10-24", "kind": "NEW", "title": "Profile editing", "details": "Profile editing with staff review; fan view of a profile."},
            {"date": "2026-10-18", "kind": "NEW", "title": "Onboarding", "details": "Artist and staff onboarding."},
            {"date": "2026-09-11", "kind": "NEW", "title": "Artists and bands", "details": "Artist and band management in the first platform build."},
        ],
    },
    {
        "id": "artist-studio",
        "name": "Artist Studio",
        "area": "Artists",
        "audience": ["Artists"],
        "summary": "Where artists upload, release, sell and talk to their fans.",
        "description": (
            "The mint-green Studio holds an artist's releases, uploads, cover art, credits, lyrics, sales, "
            "pre-sales, gift campaigns, emails and music gifts. Changes to released music wait for staff."
        ),
        "updates": [
            {"date": "2026-11-06", "kind": "NEW", "title": "Releases area", "details": "All releases, pre-sale campaigns and numbers after release."},
            {"date": "2026-10-31", "kind": "IMPROVED", "title": "Credit-only changes", "details": "Staff approve credit-only changes they made themselves."},
            {"date": "2026-10-28", "kind": "NEW", "title": "Changes to released music", "details": "Reviewed changes to released music."},
            {"date": "2026-10-27", "kind": "IMPROVED", "title": "Manage links", "details": "Artists see Manage this song or release on public pages."},
            {"date": "2026-10-23", "kind": "NEW", "title": "Mint Studio world", "details": "Artist Studio mint world, official cover art and event posters, Studio fixes."},
            {"date": "2026-10-22", "kind": "NEW", "title": "Sales page", "details": "Sales per song and release, refunds and recent sales."},
        ],
    },
    {
        "id": "events-ticketing",
        "name": "Events and tickets",
        "area": "Events",
        "audience": ["Fans", "Staff"],
        "summary": "Live events, venues, tickets with QR codes, and refunds.",
        "description": (
            "Staff run events, venues and ticket types. Fans buy tickets and get QR codes; unpaid orders "
            "are cancelled when the hold runs out, and single tickets can be refunded. Events have posters "
            "and public pages."
        ),
        "updates": [
            {"date": "2026-10-31", "kind": "NEW", "title": "Events in the home carousel", "details": "Events and releases turn in a 3D carousel on the home page."},
            {"date": "2026-10-25", "kind": "IMPROVED", "title": "Coming soon panel", "details": "Events coming soon panel for launch."},
            {"date": "2026-10-23", "kind": "NEW", "title": "Event posters", "details": "Official event posters."},
            {"date": "2026-10-18", "kind": "NEW", "title": "Refunds and cancellations", "details": "Cancel unpaid ticket orders and refund single tickets."},
            {"date": "2026-10-14", "kind": "NEW", "title": "Public events", "details": "Public events pages, staff routes, posters and What's On upgrades, public venue."},
            {"date": "2026-09-11", "kind": "NEW", "title": "Events and ticketing", "details": "Events, venues and ticketing in the first platform build."},
        ],
    },
    {
        "id": "checkout-payments",
        "name": "Checkout and payments",
        "area": "Money",
        "audience": ["Fans", "Staff"],
        "summary": "Paying for music and tickets, including Bangla QR checked by staff.",
        "description": (
            "One payment step for every purchase. Bangla QR payments show the merchant code and number; "
            "buyers send the transaction ID and finance staff confirm or reject it (staff are emailed when "
            "one arrives). A delivery address is confirmed before paying, in any country."
        ),
        "updates": [
            {"date": "2026-10-29", "kind": "IMPROVED", "title": "Simple delivery address", "details": "The same few fields for every country."},
            {"date": "2026-10-28", "kind": "IMPROVED", "title": "Addresses anywhere", "details": "Addresses and phone numbers in any country."},
            {"date": "2026-10-25", "kind": "NEW", "title": "Finance staff alerts", "details": "Finance staff are emailed when a buyer sends a Bangla QR transaction ID."},
            {"date": "2026-10-24", "kind": "FIXED", "title": "Payments and refunds", "details": "Payment, refund and security audit fixes."},
            {"date": "2026-10-23", "kind": "IMPROVED", "title": "Bangla QR checkout", "details": "Merchant name with a note, save the code, pay by merchant number, reference hint, clean code image."},
            {"date": "2026-10-18", "kind": "NEW", "title": "Bangla QR and addresses", "details": "Staff verify Bangla QR payments; delivery addresses before paying."},
            {"date": "2026-10-13", "kind": "NEW", "title": "Purchase experience", "details": "Shared payment step, QR slot, success moment, resume, late-payment safety."},
        ],
    },
    {
        "id": "home",
        "name": "Home page",
        "area": "Fans",
        "audience": ["Fans"],
        "summary": "The landing page: a turning carousel of events and releases, and the Store.",
        "description": (
            "The home hero is one composition that fits the first screen, featuring events and releases "
            "in a turning 3D carousel. It keeps turning gently with Reduce Motion on, and phones show the "
            "song, artist and cover."
        ),
        "updates": [
            {"date": "2026-11-02", "kind": "FIXED", "title": "Carousel with Reduce Motion", "details": "Keeps turning with Reduce Motion on; phones show song, artist and cover."},
            {"date": "2026-11-01", "kind": "IMPROVED", "title": "Hero fits the first screen", "details": "The landing hero is one composition."},
            {"date": "2026-10-31", "kind": "NEW", "title": "3D carousel", "details": "Events and releases in a turning 3D carousel."},
            {"date": "2026-10-25", "kind": "IMPROVED", "title": "Newest real thing", "details": "The hero features a live event, the next event, else the newest released music."},
            {"date": "2026-10-13", "kind": "NEW", "title": "Home experience", "details": "Brand fonts, greeting, pointer light, hand-over, tilt and reveals."},
        ],
    },
    {
        "id": "search-browsing",
        "name": "Search and browsing",
        "area": "Fans",
        "audience": ["Fans"],
        "summary": "Find artists, songs and releases from the header search bar.",
        "description": (
            "The header search bar finds acts, songs and releases, showing each act once with its picture. "
            "Lists focus the row under the pointer. The site has an icon, robots rules and a sitemap."
        ),
        "updates": [
            {"date": "2026-11-06", "kind": "FIXED", "title": "Search bar jumping", "details": "The header search bar no longer jumps open and shut."},
            {"date": "2026-11-01", "kind": "FIXED", "title": "Missing results", "details": "Search keeps documents with no profile row; skips only deleted acts."},
            {"date": "2026-11-01", "kind": "IMPROVED", "title": "Each act once", "details": "Each act shows once with its picture; site icon, robots and sitemap."},
            {"date": "2026-11-01", "kind": "NEW", "title": "Header search bar", "details": "Hover-focus lists and the header search bar."},
            {"date": "2026-09-12", "kind": "NEW", "title": "Search", "details": "Search in the first platform build."},
        ],
    },
    {
        "id": "accounts",
        "name": "Accounts and sign-in",
        "area": "Fans",
        "audience": ["Fans", "Artists", "Staff"],
        "summary": "Sign up, sign in (also with Google), and manage your account.",
        "description": (
            "Email sign-up with verification, or Continue with Google. Forgotten passwords can be reset "
            "by email and changed on Account. The header chip shows your picture, else your act's approved "
            "picture, else your initials."
        ),
        "updates": [
            {"date": "2026-11-02", "kind": "IMPROVED", "title": "Header picture", "details": "Falls back to the act's approved picture."},
            {"date": "2026-10-25", "kind": "FIXED", "title": "Forgot password", "details": "The reset link was never emailed; change password on Account added."},
            {"date": "2026-10-24", "kind": "IMPROVED", "title": "Sign-in lands on home", "details": "Neutral sign-up messages; sign-in lands on the home page."},
            {"date": "2026-10-13", "kind": "NEW", "title": "Continue with Google", "details": "Google sign-in, sign-up verification, password hardening and a strength meter."},
            {"date": "2026-09-11", "kind": "NEW", "title": "Accounts", "details": "Accounts, sessions, roles and permissions in the first platform build."},
        ],
    },
    {
        "id": "notifications",
        "name": "Notifications",
        "area": "Fans",
        "audience": ["Fans", "Artists", "Staff"],
        "summary": "In-app notices and emails about orders, tickets, pre-orders and gifts.",
        "description": "The bell shows notices about orders, tickets, pre-orders and gifts; important ones are emailed too.",
        "updates": [
            {"date": "2026-10-27", "kind": "FIXED", "title": "Bell clears", "details": "The bell clears once notices are read."},
            {"date": "2026-09-12", "kind": "NEW", "title": "Notifications", "details": "Notifications in the first platform build."},
        ],
    },
    {
        "id": "staff-console",
        "name": "Staff console",
        "area": "Staff",
        "audience": ["Staff"],
        "summary": "Where staff run events, review music, check payments and help customers.",
        "description": (
            "The black staff console: Live, Catalog, Money, Marketing, Insight and Admin. Catalog > Releases "
            "holds every review queue (releases, pre-sales, gift campaigns, artist emails, music gifts). "
            "Money > Customers and users lists every account and order with its payment status and a CSV."
        ),
        "updates": [
            {"date": "2026-11-06", "kind": "NEW", "title": "Feature updates log", "details": "Admin > Feature updates."},
            {"date": "2026-11-06", "kind": "NEW", "title": "Music gifts review", "details": "Catalog > Releases: music gifts waiting for review."},
            {"date": "2026-10-28", "kind": "IMPROVED", "title": "Customers with payment status", "details": "Every order a person started, with its payment status; staff menu icons."},
            {"date": "2026-10-27", "kind": "NEW", "title": "Customer list", "details": "Staff customer list with filters and CSV."},
            {"date": "2026-10-12", "kind": "IMPROVED", "title": "Restyled console", "details": "The staff console on the design system."},
        ],
    },
    {
        "id": "finance-royalties",
        "name": "Finance and royalties",
        "area": "Money",
        "audience": ["Staff", "Artists"],
        "summary": "Double-entry ledger, settlements, payouts and the royalty engine.",
        "description": "Every payment is booked in a double-entry ledger; royalty runs, statements, settlements and payouts are run by finance staff.",
        "updates": [
            {"date": "2026-09-12", "kind": "IMPROVED", "title": "Admin operations", "details": "Phase 14 admin operations hardening."},
            {"date": "2026-09-11", "kind": "NEW", "title": "Finance and royalties", "details": "Ledger, royalty engine and payouts in the first platform build."},
        ],
    },
    {
        "id": "marketing-analytics",
        "name": "Marketing campaigns and analytics",
        "area": "Staff",
        "audience": ["Staff"],
        "summary": "Staff marketing campaigns with tasks, and analytics without money tiles.",
        "description": "Staff plan marketing campaigns with tasks and links, and read analytics that say \"Not available\" rather than 0 when a number is unknown.",
        "updates": [
            {"date": "2026-09-12", "kind": "NEW", "title": "Analytics", "details": "Analytics in the platform build."},
            {"date": "2026-09-11", "kind": "NEW", "title": "Marketing campaigns", "details": "Marketing and campaigns in the platform build."},
        ],
    },
    {
        "id": "design-system",
        "name": "Design and brand",
        "area": "Platform",
        "audience": ["Fans", "Artists", "Staff"],
        "summary": "The Corner Room look: tokens, fonts, glass cards and the letter cube.",
        "description": "One design system for every page: colour tokens tested for contrast, brand fonts, glass cards and frosted bars, the letter-cube logo and formatting for money and dates.",
        "updates": [
            {"date": "2026-10-13", "kind": "IMPROVED", "title": "Restyle", "details": "Finer grain, page-wide corner light, glass cards and frosted bars."},
            {"date": "2026-10-12", "kind": "NEW", "title": "Customer frontend rebuilt", "details": "Rebuilt customer frontend and complete buying flow."},
            {"date": "2026-10-11", "kind": "NEW", "title": "Design system", "details": "Phase 16 design system foundation."},
        ],
    },
    {
        "id": "security",
        "name": "Security",
        "area": "Platform",
        "audience": ["Staff"],
        "summary": "How Corner Room keeps accounts, payments and data safe.",
        "description": "Short-lived sessions, CSRF and origin checks, separate signing secrets, security headers, rate limits, and 404 for other labels' data.",
        "updates": [
            {"date": "2026-10-25", "kind": "FIXED", "title": "Image library upgrade", "details": "Image library upgraded past published decoding vulnerabilities."},
            {"date": "2026-10-24", "kind": "IMPROVED", "title": "Security pass", "details": "Attack probes, library upgrades, web CSP, rate limits, neutral sign-up, 404 for other labels."},
            {"date": "2026-10-22", "kind": "IMPROVED", "title": "Gate 4", "details": "CSRF origin check, separate ticket and media signing secrets, API security headers, tighter CORS."},
            {"date": "2026-10-11", "kind": "IMPROVED", "title": "Gates 2 and 3", "details": "Phase 15 hardening."},
        ],
    },
    {
        "id": "operations",
        "name": "Deploys and operations",
        "area": "Platform",
        "audience": ["Staff"],
        "summary": "How new versions reach the live site safely.",
        "description": "Deploys have no downtime and can be rolled back in seconds; a staging copy, restore rehearsals and error tracking support them.",
        "updates": [
            {"date": "2026-11-03", "kind": "FIXED", "title": "Staging fixes", "details": "Staging failures are reported; web server HTTP/2 setting fixed."},
            {"date": "2026-10-30", "kind": "NEW", "title": "Zero-downtime deploys", "details": "Zero-downtime deploys, rollback, restore rehearsal, staging and error tracking."},
            {"date": "2026-10-25", "kind": "IMPROVED", "title": "Safe deploy workflow", "details": "Deploys run after checks pass, with approval."},
            {"date": "2026-10-23", "kind": "NEW", "title": "Deploy readiness", "details": "Production images, deploy, backup and restore scripts, and automated checks."},
        ],
    },
    {
        "id": "legal-help",
        "name": "Legal and help pages",
        "area": "Fans",
        "audience": ["Fans"],
        "summary": "Terms, Privacy, Refunds and the support address.",
        "description": "Default Terms, Privacy and Refunds pages and a support address in the footer.",
        "updates": [
            {"date": "2026-10-25", "kind": "NEW", "title": "Legal pages", "details": "Default Terms, Privacy and Refunds pages, footer support address."},
        ],
    },
]


def feature_updates() -> list[dict]:
    """Features with the most recently changed first; each feature's updates newest first."""
    out = []
    for f in FEATURES:
        updates = sorted(f["updates"], key=lambda u: u["date"], reverse=True)
        out.append({**f, "updates": updates, "first_date": min(u["date"] for u in updates), "last_date": updates[0]["date"]})
    out.sort(key=lambda f: f["name"].lower())
    out.sort(key=lambda f: f["last_date"], reverse=True)
    return out
