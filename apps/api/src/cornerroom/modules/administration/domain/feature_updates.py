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
        "id": "teasers",
        "name": "Previews",
        "area": "Music",
        "audience": ["Artists", "Fans", "Staff"],
        "summary": "A short part of a song that anyone can hear free, as often as they like, until they buy it.",
        "description": (
            "In Studio, the Preview Studio (its own part of each release page) lets an artist or band pick a "
            "part of a song on its waveform (at most 60 seconds), add a fade in, a fade out and a volume "
            "change, hear it as they edit, and have Corner Room make it from the song's own master, which "
            "never changes. Staff approve each preview on Catalog > Releases. Once approved, anyone can "
            "listen in its Preview Room or from the song page, release page, pre-sale page and player, "
            "without signing in or buying. After each full listen a gentle suggestion offers to buy the "
            "song or its release (or pre-book it), never stopping a replay. Previews work before and after "
            "release and stay on the same song. A newer version waits for approval while the live one "
            "keeps playing. Preview plays are not song plays: they never count as listens or earn "
            "royalties. Artists see how many times each preview was started and listened to the end. "
            "People who own a song find its preview in the song's Preview Corner."
        ),
        "updates": [
            {
                "date": "2026-11-16",
                "kind": "IMPROVED",
                "title": "Always called a preview, and a fuller Preview Room",
                "details": (
                    "Every page, button, email and note now says preview, and the pages' own addresses say previews too (old links still work). The Preview Room has a bigger "
                    "player that is ready before you press play, a copy-link button, what a preview is "
                    "in three short lines, and the song's other previews playable from the same page."
                ),
            },
            {
                "date": "2026-11-08",
                "kind": "IMPROVED",
                "title": "Preview Studio, Preview Room and Preview Corner",
                "details": (
                    "The artist's tool is the Preview Studio and has its own part of the release page. "
                    "The preview page is the Preview Room, and a song's preview section is its Preview "
                    "Corner."
                ),
            },
            {
                "date": "2026-11-08",
                "kind": "IMPROVED",
                "title": "Waveform edges easy to drag with a finger",
                "details": (
                    "The start and end edges and the play line are easy to grab and drag with a finger: "
                    "a press near a line takes it, the page no longer scrolls while dragging, and the time "
                    "shows above the finger. Larger glossy grips on touch screens."
                ),
            },
            {
                "date": "2026-11-07",
                "kind": "IMPROVED",
                "title": "Preview editor on one screen",
                "details": (
                    "The whole editor fits one screen: the play key and loop sit on the waveform's own "
                    "toolbar with undo and zoom, times, fades and volume share one row, and the actions "
                    "sit at the bottom. Glossy buttons; versions fold away."
                ),
            },
            {
                "date": "2026-11-07",
                "kind": "FIXED",
                "title": "Deleting a preview deletes its versions",
                "details": "Deleting a preview that was never public now removes every version of it too.",
            },
            {
                "date": "2026-11-07",
                "kind": "NEW",
                "title": "Preview Studio and preview listening",
                "details": (
                    "Waveform editor with zoom, typed times, fades, volume, undo and live preview; "
                    "versions with staff review; public preview page; previews on song, release and "
                    "pre-sale pages; buy suggestion after a full listen; start and full-listen counts."
                ),
            },
        ],
    },
    {
        "id": "fan-gifts",
        "name": "Fan gifts and gift credit",
        "area": "Fans",
        "audience": ["Fans", "Artists", "Staff"],
        "summary": "Buy a song or release for people you know, by email, and pay for it yourself.",
        "description": (
            "On any song, release or pre-sale page, Give as a gift (shown to owners too) opens checkout "
            "with Give it as a gift ticked; the fan types up to 10 email addresses, designs the email they "
            "get (a message with their first name and links, an optional subject, one of three looks, the "
            "cover on or off, up to 5 pictures or PDFs) while seeing it exactly as each person will, and "
            "pays for each person. Pre-orders can be gifts the same way. The sale counts for the artist when the giver pays. Corner "
            "Room checks every email a fan wrote or attached files to before anyone is emailed, and can send it in "
            "Corner Room's own words instead. Someone with an account owns the music at "
            "once; a new address gets it when it signs up with that email. Someone who already owns it "
            "chooses: keep the amount as credit for that artist's music, pass it on to another email, or "
            "say no thanks. A gift that is declined, or not claimed in 7 days, goes back to the giver as "
            "credit for that artist's music. Credit pays for a whole song or release of the same artist "
            "at checkout. The giver sees Delivered, Accepted, Passed on, Declined or Not claimed, never why. "
            "Studio Sales marks sales bought as a gift or paid with gift credit, and lists the people a "
            "gift went to as buyers. The person a gift went to earns the artist's collectible."
        ),
        "updates": [
            {"date": "2026-11-21", "kind": "IMPROVED", "title": "A small glass button", "details": "Give it to someone is one small liquid glass button under an owner's buttons, without a card or extra words; the artist's collectible is one quiet line at the end of the page."},
            {"date": "2026-11-21", "kind": "IMPROVED", "title": "Give it to someone", "details": "If you already own a song or release, Give it to someone sits in the gift section under its buttons instead of beside Play, on song and release pages."},
            {"date": "2026-11-20", "kind": "NEW", "title": "Design your gift email", "details": "Write the gift email your way, with their first name, links, a subject, a look, the cover and pictures or PDFs, and see it as each person will before you pay. Corner Room checks it first."},
            {"date": "2026-11-20", "kind": "IMPROVED", "title": "Gift music you own, and pre-orders", "details": "Give as a gift on song, release and pre-sale pages, also for people who already own it; pre-orders can be gifts; Studio Sales marks gift sales; the person gifted earns the collectible."},
            {"date": "2026-11-20", "kind": "NEW", "title": "Give music as a gift", "details": "Buy a song or release for people you know by email, with a note Corner Room checks, keep or pass on a gift you already own, and spend gift credit on the same artist's music."},
        ],
    },
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
            "time and what they get, with the cover a little blurred until the artist switches it on. "
            "On release day the music unlocks, buyers are told, and a release-day email from the "
            "artist goes out. When staff approve the finished music of a release whose pre-sale date "
            "is set, it is scheduled for that date and goes out by itself. Studio and the staff "
            "release page show one release plan (pre-sale, the music, release day) with the next step, "
            "and every time is Dhaka time. Staff can move the date (buyers are emailed), release early, send music "
            "back to pre-sale, or cancel with full refunds. Each pre-sale has its own Studio campaign "
            "pages with live numbers and share links. Buyers who paid before Corner Room launched get "
            "their music when their email is verified."
        ),
        "updates": [
            {"date": "2026-11-14", "kind": "FIXED", "title": "A draft past its date says who's next", "details": "When a pre-sale's date has passed but the artist hasn't sent the music in, the staff release page now says so and how to go on, instead of saying it goes out by itself."},
            {"date": "2026-11-13", "kind": "FIXED", "title": "Pre-sales go out on their date", "details": "Approving the finished music of a release on pre-sale now schedules it for the pre-sale date, so it goes out by itself. Before, it stayed waiting after the date."},
            {"date": "2026-11-13", "kind": "IMPROVED", "title": "One release plan", "details": "Studio and the staff release page show the pre-sale, the music and release day as three steps with the next thing to do. Staff see only the buttons that apply now; rare ones sit under More actions."},
            {"date": "2026-11-13", "kind": "IMPROVED", "title": "Pre-sale has its own part", "details": "In Studio the pre-sale is its own part of the release page: numbered steps with what fans see beside them."},
            {"date": "2026-11-13", "kind": "FIXED", "title": "Times in Dhaka time", "details": "Release and pre-sale times show in Dhaka time everywhere, not UTC."},
            {"date": "2026-11-07", "kind": "IMPROVED", "title": "Cover switch", "details": "One on/off switch in the pre-sale: off shows the cover, or the title screen, a little blurred; on shows it clearly."},
            {"date": "2026-11-07", "kind": "FIXED", "title": "Shown covers no longer blurred", "details": "A cover the artist has shown now appears clearly instead of staying blurred."},
            {"date": "2026-11-07", "kind": "IMPROVED", "title": "Glossy Pre-book button", "details": "The Pre-book button over a pre-sale cover is a glossy glass button."},
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
            {"date": "2026-11-09", "kind": "NEW", "title": "Artist Mailbox", "details": "Studio > Mailbox: every email sent for an act, to whom, when, why and whether it went, with search, filters and a reading pane; plus waiting emails, writing, automatic emails, templates and the report in one place."},
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
            "when they send it and always by staff, with one click to mark everyone prepared. Marking a "
            "gift emails nobody: the artist presses Send update for dispatched, returned or missing gifts, "
            "sees the email first, and only then are those buyers told. A "
            "release's numbers page shows its collectibles. Music given free through a music gift doesn't "
            "earn a campaign gift. Music bought as a fan gift earns it for the person it was given to, never "
            "the giver; music paid with gift credit earns it for its buyer."
        ),
        "updates": [
            {"date": "2026-11-21", "kind": "IMPROVED", "title": "Called a collectible everywhere", "details": "What used to be a gift campaign is now a collectible on every page, for artists and staff, and in every email and note buyers get. Song and release pages say a collectible from the artist comes with the music, in one short line at the end of the page. Music gifts and gifts from fans keep their name."},
            {"date": "2026-11-21", "kind": "IMPROVED", "title": "The gift stays a surprise", "details": "Song and release pages only say that the artist gives a gift with the music, and Corner Room's own emails and notes no longer say what it is, so buyers find out when it's in their hands."},
            {"date": "2026-11-20", "kind": "IMPROVED", "title": "Gift updates wait for Send update", "details": "Marking gifts Dispatched, Returned or Missing no longer emails anyone. The artist presses Send update (for the whole status or the chosen gifts), checks the email, then it goes."},
            {"date": "2026-11-20", "kind": "FIXED", "title": "One buyer's name sent to everyone", "details": "Copying and pasting in the email writer turned the First name fill-in into the previewed buyer's name. It stays a fill-in now, and emails that greet a buyer by a typed name are stopped with a one-click fix."},
            {"date": "2026-11-09", "kind": "NEW", "title": "Emails to buyers you pick need approval", "details": "An email to buyers picked by hand goes to Corner Room with its people as one request; once approved, the artist presses Send. Staff send at once."},
            {"date": "2026-11-09", "kind": "IMPROVED", "title": "Emails on the campaign page", "details": "Each campaign has Collectibles and Emails parts: tick gifts and press Email them, see automatic emails and every gift email sent, with search."},
            {"date": "2026-11-09", "kind": "IMPROVED", "title": "Calmer collectible tracking", "details": "Status chips with counts, search by name, email, phone or address, and a floating bar for the chosen gifts."},
            {"date": "2026-11-08", "kind": "IMPROVED", "title": "Clearer gift emails", "details": "Each status shows the email buyers get now, three steps (write, approval, buyers get it), a check before emailing buyers, and each buyer's own line saying on its way, sent or couldn't send."},
            {"date": "2026-11-08", "kind": "FIXED", "title": "Staff stay in the staff console", "details": "Staff approve gift emails and added people right in the staff gift list; the staff release page no longer opens the artist's Preview Studio or pre-sale pages."},
            {"date": "2026-11-07", "kind": "IMPROVED", "title": "Gift email composer", "details": "One-click templates, a preview as each buyer by name, a button, files, a test to yourself, and emailing chosen buyers by status."},
            {"date": "2026-11-07", "kind": "NEW", "title": "Your own gift emails", "details": "Artists word the dispatched, returned and missing emails for each gift campaign in Studio's email editor; Corner Room approves them once."},
            {"date": "2026-11-07", "kind": "FIXED", "title": "Waiting people in the staff list", "details": "The staff list says how many people an artist added wait for approval, with a link to approve them."},
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
            {
                "date": "2026-11-16",
                "kind": "NEW",
                "title": "Open price",
                "details": "An artist can turn on Open price when proposing the price of a song or release. The agreed price is then the lowest amount, and each buyer chooses what to pay from there up at checkout. Wherever the music is listed its price reads From and the amount. Staff see that a proposal is an open price before agreeing to it. Every open price is between ৳10 and ৳100,000.",
            },
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
            "read. Bought songs can be saved in the browser and played with no connection. Catalog staff, "
            "administrators and the music's own artist or band listen without buying."
        ),
        "updates": [
            {"date": "2026-11-21", "kind": "IMPROVED", "title": "Admins play every song", "details": "Corner Room's own admins play every song on Corner Room without buying; a label's staff still play only their label's music."},
            {
                "date": "2026-11-16",
                "kind": "IMPROVED",
                "title": "A handier player bar",
                "details": "The bar at the bottom shows how far the song is as a line of light on its top edge, on phones too. It has volume and mute, an Up next list to jump to any coming song, small level bars while playing, and keyboard keys: Space to play or pause, the arrows to move five seconds, M to mute, Shift+N and Shift+P for next and previous.",
            },
            {"date": "2026-11-16", "kind": "FIXED", "title": "Administrators listen without buying", "details": "Administrators had to buy songs unless they were also catalog staff. They now play every song of their workspace without buying, like catalog staff and the music's own artist or band."},
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
            "from the start, with a small lyrics icon beside the close button that lights up when they're on "
            "and is crossed out when they're off; turning them off is remembered on that device. A gift icon "
            "in the same corner opens Give as a gift; its words slide out when you point at it. The room is one still screen that fits the window without "
            "scrolling, and a double-click on empty space goes properly full screen (the same again comes "
            "out). The big "
            "title links to the song page. When the browser blocks the automatic start, the room shows the "
            "song's real length and a lit play key. People who own a song can share a moment of it, up to "
            "30 seconds they pick, as a story on Instagram, Facebook, WhatsApp and other apps: a video of a "
            "liquid glass Corner Room card with the song's sound and its lyrics moving with the singing, "
            "made on their own phone or computer. Artists can turn story sharing off for a release."
        ),
        "updates": [
            {"date": "2026-11-22", "kind": "IMPROVED", "title": "Spin through every song", "details": "Hold the mouse beside the front song and the carousel keeps spinning that way, each next song coming to the front, all the way to the last one, faster the further out you point. Point back at the middle and it stops on a song; click it to play it. Spinning never changes what is playing, and a moment after the mouse leaves the carousel glides back to the song that is on."},
            {"date": "2026-11-22", "kind": "IMPROVED", "title": "The carousel spins toward the mouse", "details": "Point beside the front song and the carousel spins that way, drawing the next song on that side toward the front, and flows back when the mouse leaves. Moving to another song glides the whole carousel round on the same smooth spring. Hovering never changes the song, and it stays still for people who prefer less motion."},
            {"date": "2026-11-22", "kind": "IMPROVED", "title": "The carousel turns toward the mouse", "details": "With a mouse over the track carousel, the whole carousel swings in 3D to follow the pointer and settles back when it leaves. It never changes the song, and stays still for people who prefer less motion."},
            {"date": "2026-11-22", "kind": "FIXED", "title": "Lyrics keep turning under the mouse", "details": "Pointing at a line on the lyric ring lights it, and the ring keeps turning instead of stopping."},
            {"date": "2026-11-21", "kind": "IMPROVED", "title": "Quieter corner controls", "details": "The lyrics switch is now one lyrics icon that lights up or is crossed out, and a gift icon beside it opens Give as a gift, its words showing when you point at it."},
            {"date": "2026-11-14", "kind": "IMPROVED", "title": "Title on one line", "details": "The room's big title always fits on one line, however long, getting smaller as needed; no word or bracket is left on a line of its own. The version sits after it, smaller and quieter, as a note on which version it is."},
            {"date": "2026-11-14", "kind": "IMPROVED", "title": "Version after the title", "details": "When the artist gives a song a version, such as Acoustic Demo, the room's big title shows it in brackets after the song's name."},
            {"date": "2026-11-14", "kind": "FIXED", "title": "Bar fits the song", "details": "The song box in the room's bar keeps room for the title, Playing and the scrubber; on smaller screens the tools move to their own row."},
            {
                "date": "2026-11-08",
                "kind": "NEW",
                "title": "Share as a story",
                "details": (
                    "A Share button in the room for people who own the song: pick up to 30 seconds, see the "
                    "card play, make the video and share it to Instagram, Facebook or WhatsApp stories (or "
                    "save it). The card is liquid glass with the cover, title, artist and moving lyrics. "
                    "Artists can turn it off per release under Details > Sharing."
                ),
            },
            {"date": "2026-11-07", "kind": "FIXED", "title": "Sharp covers", "details": "Large covers in the room use the full-size picture, so they no longer look soft or pixelated."},
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
            {"date": "2026-11-14", "kind": "IMPROVED", "title": "Version as a note", "details": "On the song page the version after the title is smaller and quieter, and never split across lines."},
            {"date": "2026-11-14", "kind": "IMPROVED", "title": "Version after the title", "details": "A song's version, such as Acoustic Demo, shows in brackets after its name on the song page."},
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
            "Artists add song lyrics in Studio; staff review them and later changes. On Catalog > Releases, "
            "Sync lyrics finds any released song by its title or artist; its page plays the song, staff hold "
            "Space while each line is sung (pressing marks its start, letting go its end), and they can fix "
            "the words on the same page. In the listening room a line goes quiet once its singing ends. Fixed "
            "words show on the song page, in the listening room and in Studio. A spelling or spacing fix keeps every time; "
            "adding or removing a line keeps the times before it. Staff who run the act wait for approval "
            "like any artist."
        ),
        "updates": [
            {"date": "2026-11-22", "kind": "NEW", "title": "An end for every line", "details": "Staff hold Space while a line is sung: pressing marks where it starts and letting go where it ends. A quick tap still works, and that line then runs on until the next one. The timeline shows each line as a bar, the lines list shows both times, and the listening room and story videos let a line go quiet once its singing ends. Songs synced before keep their starts and show Needs line ends."},
            {"date": "2026-11-21", "kind": "IMPROVED", "title": "A calmer, smoother sync page", "details": "The song search lists nothing until staff start typing, then unfolds with the typed words lit. The sync page shows the line before and after the one to tap, a timeline of the song with a mark for every tap (click to jump), a list that follows along, and P to play or pause."},
            {"date": "2026-11-21", "kind": "IMPROVED", "title": "Find a song and fix its words while syncing", "details": "Staff search released songs by title or artist instead of pasting an address, and fix the words, spacing and lines on the sync page; one Save keeps the words and their times together, and the song page, listening room and Studio show the fix."},
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
            {
                "date": "2026-11-16",
                "kind": "IMPROVED",
                "title": "Studio answers the mouse",
                "details": "Every Studio card catches a soft mint light where the mouse is and its edge brightens beside it, a line of light follows along the header, the menu marks the page with a sliding marker, and buttons settle when pressed. Nothing moves while the mouse is still.",
            },
            {
                "date": "2026-11-08",
                "kind": "IMPROVED",
                "title": "Release page in parts",
                "details": (
                    "A release page shows one part at a time: Details, Songs, Preview Studio, Price and "
                    "Review, with a count of what is still missing on each. Songs fold to one line and "
                    "open on their own Song, Audio, Credits and Lyrics tabs."
                ),
            },
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
            {"date": "2026-11-21", "kind": "NEW", "title": "Staff test buys", "details": "When a Corner Room admin buys, it is a test: they go through checkout as a fan would and press Complete as a test. No money moves, and it never reaches sales, royalties, the artist or any live numbers."},
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
        "summary": "The landing page: a turning carousel of events and releases, Trending Corner, and the Store.",
        "description": (
            "The home hero is one composition that fits the first screen, featuring events and releases "
            "in a turning 3D carousel. It keeps turning gently with Reduce Motion on, and phones show the "
            "song, artist and cover. Trending Corner shows the music staff pick as selling and being heard "
            "the most, as real 3D picture CDs turning in a glass carousel over a gloss floor, with a small "
            "player for the disc in front. The hero and the New releases row show the five newest releases."
        ),
        "updates": [
            {
                "date": "2026-11-27",
                "kind": "IMPROVED",
                "title": "The 3D parts follow your scrolling, then finish when you stop",
                "details": "The parts at the end of the home page now move with your scrolling, forward and back at your own speed, like turning a dial. When you stop, whatever was part-way finishes by itself: everything on screen settles into its finished, readable frame, and the turning block finishes its turn in the way you were going.",
            },
            {
                "date": "2026-11-27",
                "kind": "FIXED",
                "title": "The 3D parts finish wherever you stop scrolling",
                "details": "Stopping part-way left cards half-arrived and hard to read until you scrolled on. Now each part plays its whole entrance once it is on screen, wherever you stop, and the turning block always comes to rest on a whole side. Scroll back up past a part and it goes back, ready to play again.",
            },
            {
                "date": "2026-11-26",
                "kind": "IMPROVED",
                "title": "The explanations move to the end, in 3D",
                "details": "What Corner Room is, how it works, what artists get, the questions and the way in now close the home page, after the music. They move as you scroll: the three sides of the room turn as one block that rests on each side, the steps stand up off the floor one by one, the artists card leans toward the mouse, answers open smoothly and two doors swing open on the way in. Nothing moves by itself, and people who ask for less motion see it all still.",
            },
            {
                "date": "2026-11-26",
                "kind": "IMPROVED",
                "title": "Trending Corner: listens only in the big figure",
                "details": "The small listen count under the title is gone; the listens show only as the large figure behind the discs. That figure now has real depth: each numeral is a solid block with layered red sides that shift as you move the mouse, a brushed face, and a band of light that crosses it when the number rolls.",
            },
            {
                "date": "2026-11-18",
                "kind": "IMPROVED",
                "title": "Trending Corner as one card, with listens in millions",
                "details": "The discs and the player below them are now one card instead of two. Behind the discs, the front one's listens stand very large in millions, as on the song page (an album's or EP's listens are all its songs together). The figure rolls on like a counter when the front changes, turns a little toward the pointer and shows in the gloss floor.",
            },
            {
                "date": "2026-11-16",
                "kind": "IMPROVED",
                "title": "A longer home page that explains Corner Room",
                "details": "New parts say what Corner Room is (the live room, the listening room, your shelf), how listening works in four steps, what artists get, and answer the usual questions, with a way in at the end. Scrolling from events to music now changes the whole window from the red room to the blue one, and cards catch a soft light under the mouse.",
            },
            {"date": "2026-11-15", "kind": "IMPROVED", "title": "Trending Corner in real 3D", "details": "The discs are now real 3D picture CDs: the cover under a clear gloss, a clear centre with its raised ring, a silver band that throws a CD's rainbow as it turns, a gloss floor that reflects them and soft shadows. Point at a disc and it lifts and tilts toward the pointer under a lamp that follows it; the discs lean as the ring spins and settle with a little wobble. Browsers without 3D keep the earlier discs."},
            {"date": "2026-11-15", "kind": "IMPROVED", "title": "Five newest releases", "details": "The hero carousel and the New releases row now show the five newest releases (was three in the hero and four in the row)."},
            {"date": "2026-11-08", "kind": "FIXED", "title": "Singles listed twice in Trending Corner", "details": "Staff saw a single twice (the single and its one song). A single now shows once, as the single, and a song and the release it is on can no longer both be picked."},
            {"date": "2026-11-08", "kind": "NEW", "title": "Trending Corner", "details": "Staff pick the music selling and being heard the most (Catalog > Trending Corner, with sales and listens beside each). On the home page it turns as discs you can point at, click, drag or swipe; the one in front plays below: the whole song for owners, its preview for everyone else."},
            {"date": "2026-11-08", "kind": "IMPROVED", "title": "Less empty space under the hero", "details": "The welcome shortcuts sit closer under the hero."},
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
            {
                "date": "2026-11-16",
                "kind": "IMPROVED",
                "title": "Smoother moves between pages",
                "details": "A thin line of light across the top shows a page is loading from the moment a link is pressed, the arriving page fades in, and the mark under a menu link draws in on hover.",
            },
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
            {
                "date": "2026-11-21",
                "kind": "IMPROVED",
                "title": "Fewer clicks to the work",
                "details": "The side menu shows how much is waiting beside each page, Catalog has a bar of the queues with work that glides to each one, Ctrl+K lists waiting queues first, and / jumps to a page's search. Pages, cards, buttons and lists answer with short, quiet motion (none when the device asks for less motion).",
            },
            {
                "date": "2026-11-16",
                "kind": "IMPROVED",
                "title": "A tighter staff console",
                "details": "The staff home shows what is waiting in each review queue. Ctrl+K finds any staff page. Every staff page uses smaller, denser controls and tables, and fields that were named only by grey hint text now have real labels; amounts in the smallest unit explain what to type.",
            },
            {
                "date": "2026-11-09",
                "kind": "IMPROVED",
                "title": "Artists always wait, staff never do",
                "details": (
                    "Whatever an artist's team sends waits for staff, even when that person is also staff. "
                    "What staff send for an act they are not part of is approved at once. Staff approve "
                    "picked-buyer gift emails, words and people together, in the staff gift list."
                ),
            },
            {
                "date": "2026-11-07",
                "kind": "IMPROVED",
                "title": "One staff member approves alone",
                "details": (
                    "While Corner Room has one staff member, nobody else is needed to approve: what staff "
                    "send in (releases, pre-sales, changes, lyrics, emails, gifts, preview, managers, "
                    "profile changes) is approved at once, and staff may approve their own work. Artists "
                    "without staff rights still wait for staff. A setting turns the second approval back on."
                ),
            },
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
        "description": (
            "One design system for every page: colour tokens tested for contrast, brand fonts, glass cards and "
            "frosted bars, the letter-cube logo and formatting for money and dates. Every logo tilts toward the "
            "pointer in 3D, lifts and catches a sheen; the Artist Studio's green logo sits on a soft mint glow."
        ),
        "updates": [
            {"date": "2026-11-07", "kind": "IMPROVED", "title": "Logos come alive", "details": "Every logo tilts toward the pointer, lifts and catches a sheen; still on touch and with reduced motion."},
            {"date": "2026-11-07", "kind": "IMPROVED", "title": "Studio logo without the square", "details": "The green Studio logo sits on a soft mint glow instead of a flat square tile."},
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
