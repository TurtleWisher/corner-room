/*
 * Default Terms, Privacy and Refunds text (owner, 2026-10-25: "make a default one for now").
 * Every sentence describes what the product does today (code and decision log, cited in the
 * comments); nothing here sets a new business rule. Undecided points (purchase-terms wording,
 * retention periods, governing law, the operating entity) are left out or named as not set yet.
 * A lawyer should review this before it is treated as final (CLAUDE.md content rules).
 */

export type LegalSection = {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
};

export type LegalDocument = {
  title: string;
  /** Shown as "Last updated"; ISO date. */
  updated: string;
  lede: string;
  sections: LegalSection[];
};

export const LEGAL_UPDATED = "2026-10-25";

export const TERMS: LegalDocument = {
  title: "Terms of use",
  updated: LEGAL_UPDATED,
  lede: "The rules for using Corner Room, buying tickets and music, and sharing your own music here.",
  sections: [
    {
      heading: "About these terms",
      paragraphs: [
        "Corner Room is a place to find live events, buy tickets, and listen to and buy music from Bangladeshi artists. By creating an account or buying something here, you agree to these terms.",
        "We may update these terms. The date at the top shows the latest version, and changes apply from that date.",
      ],
    },
    {
      heading: "Your account",
      bullets: [
        "Use your own email address and keep your password to yourself. You are responsible for what happens in your account.",
        "An account made with an email and password is activated through a link we email to you.",
        "You can see the devices signed in to your account and sign them out on your Account page.",
        "We may suspend an account that breaks these terms or puts other people or the service at risk.",
      ],
    },
    {
      heading: "Buying tickets and music",
      // D-PAY-01, Q-PAY-01/05 (staff verification), Q-PAY-02 and Q-COM-03 (late payment refunded).
      bullets: [
        "Prices are shown in Bangladeshi taka (BDT) before you pay.",
        // D-ADDR-01, D-ADDR-02 (any country since 2026-10-27).
        "Before paying, you give an address, in Bangladesh or abroad, where gifts can be sent to you.",
        "You pay with Bangla QR: scan the code or pay the merchant number shown at checkout, then tell us the transaction ID.",
        "Our team checks every payment. Your order is complete once we confirm it, and your tickets stay held for you while we check.",
        "If we can't match a payment, we tell you why so you can send the details again.",
        "If an order is cancelled because payment did not arrive in time and you paid later, we refund that payment in full.",
      ],
    },
    {
      heading: "Tickets",
      bullets: [
        "Each ticket has its own QR code. It is scanned once at the door; a second scan of the same ticket is refused.",
        "Keep your QR code private. Anyone who has it can use it.",
        "If an event is postponed or cancelled, the event page says so.",
      ],
    },
    {
      heading: "Music you buy",
      // D-AUDIO-06 (downloads, refund removes access), D-AUDIO-14 (takedowns).
      bullets: [
        "When you buy a song or a release, you can play it on Corner Room and download it for your own personal listening.",
        "Buying a release gives you all of its songs.",
        "You may not resell, share publicly, broadcast or upload the music anywhere else.",
        "If an artist or label takes a song down, you keep the song you bought. If a song has to be removed for a legal reason, it may be removed for everyone.",
        "If a purchase is refunded, you can no longer play or download it.",
      ],
    },
    {
      heading: "Artists and their music",
      bullets: [
        "If you upload music, artwork, photos or profile details, you confirm that you have the rights to do so, for both the recording and the song itself.",
        "You allow Corner Room to store, convert, show, stream and sell what you upload, as agreed with your label.",
        "Our staff review releases and profile changes before they go public, and may refuse or remove content.",
        "How sales are shared with artists is set in each artist's agreement with their label, not in these terms.",
      ],
    },
    {
      heading: "Fair use of the service",
      bullets: [
        "Don't use Corner Room to break the law or to upload anything you don't have the rights to.",
        "Don't try to get into other people's accounts, get around payments or access checks, or overload the service.",
        "We limit how often some actions can be repeated, such as signing in and downloading, to keep accounts safe.",
      ],
    },
    {
      heading: "If something goes wrong",
      paragraphs: [
        "We work to keep Corner Room running and your purchases safe, but we can't promise the service will always be available without interruption. If you have a problem with an order, a ticket or your account, contact us and we will look into it.",
      ],
    },
  ],
};

export const PRIVACY: LegalDocument = {
  title: "Privacy",
  updated: LEGAL_UPDATED,
  lede: "What we collect when you use Corner Room, why, and who can see it.",
  sections: [
    {
      heading: "What we collect",
      bullets: [
        "Your account: email address, display name, profile picture if you add one, and your password, stored only as a secure hash that nobody can read.",
        "If you continue with Google: your Google account ID and email, to link it to your account. We don't receive your Google password.",
        "Your orders, tickets, purchases and refunds, and the payment details you give us at checkout: the transaction ID, the number you paid from and the app you used.",
        "The delivery address you give before paying, so gifts can reach you: recipient name, mobile number and address.",
        "What you do in the music player and library: what you play, like, save, follow and add to playlists.",
        "Security records: when you sign in we keep the device's browser description and internet address, for your list of signed-in devices and to protect your account.",
        "For artists: stage name, bio and picture are public. A legal name, when given, is seen by our staff only.",
      ],
    },
    {
      heading: "Why we use it",
      bullets: [
        "To run your account and sign you in.",
        "To sell and deliver tickets and music, check payments and handle refunds.",
        "To send the emails you need: account verification, password reset, and notices about your orders.",
        "To keep Corner Room secure and stop abuse.",
        "To show artists how their music sells. Artists see totals and sale dates, never who bought.",
      ],
    },
    {
      heading: "Who can see it",
      bullets: [
        "Corner Room staff who need it for their work, such as checking payments, handling refunds and support.",
        "The companies that run our servers, backups and email delivery for us.",
        "Google, only if you choose to continue with Google.",
        "Your payment app keeps its own record of your payment.",
        "We don't sell your personal data, and we don't use advertising or third-party tracking on Corner Room.",
      ],
    },
    {
      heading: "Cookies and storage on your device",
      paragraphs: [
        "We use one essential cookie that keeps you signed in. Your browser also remembers a few settings, such as the player volume. We don't use advertising or analytics cookies.",
      ],
    },
    {
      heading: "How long we keep it",
      paragraphs: [
        "We keep your account details while your account is open. Records of orders, payments and refunds are kept for accounting. Fixed retention periods have not been set yet; we will publish them here when they are.",
      ],
    },
    {
      heading: "Your choices",
      bullets: [
        "Change your name, picture and delivery address, and see and sign out your devices, on your Account page.",
        "Ask us for a copy of your data, to correct it, or to close your account. Some records, such as payments, we have to keep.",
      ],
    },
    {
      heading: "How we protect it",
      paragraphs: [
        "The site uses HTTPS. Passwords are stored with Argon2id hashing. Links to play or download music are signed and expire after a short time, and access is checked again every time.",
      ],
    },
  ],
};

export const REFUNDS: LegalDocument = {
  title: "Refunds",
  updated: LEGAL_UPDATED,
  lede: "How to ask for your money back for tickets and music, and what happens next.",
  sections: [
    {
      heading: "How to ask",
      paragraphs: [
        "Email us with the order reference (it starts with CR- and is on your receipt) and tell us why you are asking.",
      ],
    },
    {
      heading: "Who decides",
      // D-REF-01: every refund reason needs finance approval.
      paragraphs: ["Every refund is reviewed and approved by our finance team. We will tell you the outcome."],
    },
    {
      heading: "Reasons we handle",
      // The six platform reasons seeded by seed_foundation (D-REF-01).
      bullets: [
        "You ask for a refund.",
        "The event is cancelled.",
        "The event is postponed and you can't attend the new date.",
        "Your payment arrived after the order was cancelled. We refund this in full.",
        "You paid twice for the same order.",
        "Something went wrong on our side.",
      ],
    },
    {
      heading: "Tickets",
      bullets: [
        "You can have some tickets in an order refunded and keep the others.",
        "A refunded ticket's QR code stops working straight away.",
      ],
    },
    {
      heading: "Music",
      paragraphs: ["When a song or release purchase is refunded, you can no longer play or download it."],
    },
    {
      heading: "How the money comes back",
      paragraphs: [
        "We send the money back to the account you paid from, and the refund shows on your order. We can't promise a fixed number of days yet, but we will keep you updated.",
      ],
    },
    {
      heading: "Orders that were never paid",
      paragraphs: [
        "If an order isn't paid before its hold time ends, it is cancelled and its seats are released. There is nothing to refund.",
      ],
    },
  ],
};

export const LEGAL_DOCUMENTS = { terms: TERMS, privacy: PRIVACY, refunds: REFUNDS } as const;
