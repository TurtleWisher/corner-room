/*
 * Starting words for artists' emails (owner, 2026-11-02, D-MAIL-02): a thank-you for each audience
 * (everyone or pre-sale buyers) and each kind of music chosen (any of the act's music, one song, a
 * single, an EP, an album, several), and an email for each occasion. Written in the act's own voice:
 * "I" for an artist, "we" for a band. Fill-ins ({first_name}, {music}, {artist}) become each buyer's
 * own words when the email goes; the artist edits anything. Places to complete are written
 * "[add ...]" and Studio asks for them before sending (`unfilledMarks`). No facts are made up.
 */

import type { MailWho, MailWork, Occasion } from "@/features/artist-mail/api";

export type Voice = "I" | "we";

export type Shape =
  | { kind: "any" }
  | { kind: "song" }
  | { kind: "release"; releaseType: string }
  | { kind: "several"; count: number };

export type Starter = { subject: string; body: string };

/** What was chosen, in the words a starter needs. A single is written about like a song. */
export function shapeOf(works: MailWork[], releaseTypes: Record<string, string> = {}): Shape {
  if (works.length === 0) return { kind: "any" };
  if (works.length > 1) return { kind: "several", count: works.length };
  const [only] = works;
  if (only.type === "TRACK") return { kind: "song" };
  const type = releaseTypes[only.id] ?? "ALBUM";
  return type === "SINGLE" ? { kind: "song" } : { kind: "release", releaseType: type };
}

function words(voice: Voice) {
  const band = voice === "we";
  return {
    we: band ? "we" : "I",
    We: band ? "We" : "I",
    us: band ? "us" : "me",
    our: band ? "our" : "my",
    Our: band ? "Our" : "My",
    wed: band ? "we'd" : "I'd",
    Wed: band ? "We'd" : "I'd",
    were: band ? "we're" : "I'm",
    Were: band ? "We're" : "I'm",
    weve: band ? "we've" : "I've",
    Weve: band ? "We've" : "I've",
  };
}

const lines = (...parts: string[]) => parts.join("\n\n");

/** The thank-you sent on purchase, for one audience and one kind of music. */
export function thankYouStarter(who: MailWho, shape: Shape, voice: Voice): Starter {
  const v = words(voice);
  if (who === "PRESALE") {
    return {
      subject: "You were here first. Thank you, {first_name}",
      body: lines(
        "Hi {first_name},",
        `You bought {music} before anyone else could hear it, and ${v.we} want you to know how much that matters.`,
        `Buying in a pre-sale is a leap of faith. You trusted ${v.us} with music you hadn't heard yet, and that trust carried ${v.us} through the last stretch of making it. Knowing people like you were waiting made every late night in the studio feel lighter.`,
        shape.kind === "release"
          ? `{music} is in your library now. If you can, give it one full listen from the first song to the last, the way ${v.we} imagined it.`
          : "{music} is in your library now, yours to keep and play as often as you like.",
        "Thank you for being one of the first. It means more than a few lines can say.",
        "With gratitude,\n{artist}",
      ),
    };
  }
  switch (shape.kind) {
    case "song":
      return {
        subject: "Thank you for buying {music}",
        body: lines(
          "Hi {first_name},",
          "Thank you for buying {music}. It means a lot.",
          `A song can take months to get right: a line that wouldn't leave ${v.us} alone, a melody hummed into a phone at two in the morning, more versions than ${v.wed} like to admit. Knowing it has found its way to you makes every one of those nights worth it.`,
          `{music} is yours now, to keep and play whenever you like. If it ends up as the soundtrack to a long ride home or a quiet morning, ${v.wed} love to hear about it.`,
          "With thanks,\n{artist}",
        ),
      };
    case "release": {
      const what = shape.releaseType === "EP" ? "an EP" : shape.releaseType === "LIVE" ? "a live record" : shape.releaseType === "COMPILATION" ? "a collection" : "an album";
      return {
        subject: "Thank you for buying {music}",
        body: lines(
          "Hi {first_name},",
          "Thank you for buying {music}. It means a lot.",
          shape.releaseType === "EP"
            ? `An EP is a small world of songs that belong together, and ${v.we} poured everything into making each one earn its place. You've given that world a home in your collection.`
            : `${what.charAt(0).toUpperCase()}${what.slice(1)} asks for more than a few minutes of anyone's time. You've given it a place in your collection, and that means more to ${v.us} than ${v.we} can easily put into words.`,
          `These songs were made to be heard together. When you have the time, play {music} from start to finish, in order, with the volume up. That's how ${v.we} hear it in ${v.our} heads.`,
          `Thank you for listening closely. ${v.Wed} love to know which song stays with you.`,
          "With thanks,\n{artist}",
        ),
      };
    }
    case "several":
      return {
        subject: "Thank you for picking up {music}",
        body: lines(
          "Hi {first_name},",
          "Thank you for picking up {music}. It means a lot.",
          `Choosing more than one of ${v.our} songs is a kind of trust ${v.we} don't take lightly. It tells ${v.us} the music is becoming part of your days, and that is the best reason ${v.weve} got to keep writing.`,
          `Everything you bought is in your library now. Put it on shuffle, play it in order, make it yours. And if one of them becomes a favourite, ${v.wed} love to know which.`,
          "With thanks,\n{artist}",
        ),
      };
    default:
      return {
        subject: "Thank you for buying {music}",
        body: lines(
          "Hi {first_name},",
          `Thank you for buying {music}. It means a great deal to ${v.us}.`,
          `Buying music is the most direct way to back an artist, and it tells ${v.us} that something ${v.we} made found a home with you. That is the best news ${v.we} can get.`,
          `Your music is in your library now, ready whenever you are. Play it loud, play it often, and if a song finds its way into one of your days, ${v.wed} love to know.`,
          "With thanks,\n{artist}",
        ),
      };
  }
}

export const OCCASION_LABEL: Record<Occasion, string> = {
  NOTE: "Personal note",
  NEW_RELEASE: "New music coming",
  PRESALE_THANKS: "Thank early supporters",
  MILESTONE: "Milestone",
  BEHIND_THE_SCENES: "Behind the scenes",
  SHOW: "Live show",
  GIFT: "A gift for buyers",
};

export const OCCASIONS = Object.keys(OCCASION_LABEL) as Occasion[];

/** An email to buyers for one occasion, written for who gets it and what they bought. */
export function occasionStarter(occasion: Occasion, who: MailWho, shape: Shape, voice: Voice): Starter {
  const v = words(voice);
  const because = who === "PRESALE" ? "You bought {music} in the pre-sale, before anyone else could hear it" : "You bought {music}";
  const sign = "{artist}";
  switch (occasion) {
    case "NEW_RELEASE":
      return {
        subject: "Something new from {artist}",
        body: lines(
          "Hi {first_name},",
          `${because}, so you're one of the first people ${v.we} wanted to tell: there's new music on the way.`,
          "[add the title, what it is and when it comes out]",
          `${v.Weve} been living with these songs for a while now, and ${v.were} excited (and a little nervous) to finally let them out. If {music} meant something to you, ${v.we} think you'll find something here too.`,
          `It will be on Corner Room the moment it's out. Thank you for listening, and for being here.`,
          `See you soon,\n${sign}`,
        ),
      };
    case "PRESALE_THANKS":
      return {
        subject: "Thank you for believing in {music} early",
        body: lines(
          "Hi {first_name},",
          `${because}. ${v.We} haven't forgotten that.`,
          `Pre-sale buyers are the people who say yes before the world has heard a note. You gave ${v.us} the confidence to finish {music} the way ${v.we} hoped, and ${v.we} wanted to thank you properly, in ${v.our} own words.`,
          "[add something just for early supporters: a story, a first look, a thank-you]",
          `Thank you for being one of the first.\n${sign}`,
        ),
      };
    case "MILESTONE":
      return {
        subject: "{music} has come a long way, thanks to you",
        body: lines(
          "Hi {first_name},",
          `${because}, and ${v.we} wanted you to be among the first to hear this:`,
          "[add the milestone, for example a number of listens or a place the song reached]",
          `None of this happens without people like you choosing to buy the music and share it. Every play, every recommendation to a friend, every time you put it on for someone else, it all adds up.`,
          `Thank you for being part of the story.\n${sign}`,
        ),
      };
    case "BEHIND_THE_SCENES":
      return {
        subject: "The story behind {music}",
        body: lines(
          "Hi {first_name},",
          `${because}, so ${v.we} wanted to share something you won't find in the credits: how it came together.`,
          "[add the story: where it started, a line that changed, a moment in the studio you still think about]",
          shape.kind === "release"
            ? `Next time you play it, listen for the moments ${v.we} just told you about. They're in there.`
            : "Next time you play it, listen for that moment. It's in there.",
          `Thanks for caring about the music as much as ${v.we} do.\n${sign}`,
        ),
      };
    case "SHOW":
      return {
        subject: "Come and hear {music} live",
        body: lines(
          "Hi {first_name},",
          `${because}, so ${v.we} wanted you to hear this first: ${v.were} playing live, and it would mean a lot to see you there.`,
          "[add the date, the venue and where to get tickets]",
          `Songs change on stage. They get louder, slower, stranger, closer. Hearing {music} in a room full of people who love it is something ${v.we} can't wait to share with you.`,
          `Hope to see you there,\n${sign}`,
        ),
      };
    case "GIFT":
      return {
        subject: "A little something for you, {first_name}",
        body: lines(
          "Hi {first_name},",
          `${because}, and ${v.we} made something to say thank you. You'll find it just below this message.`,
          "[add what the gift is and why you made it]",
          `It's ${v.our} way of saying that buyers like you are the reason ${v.we} keep making music. Keep it, print it, share it with someone who'd love it.`,
          `With thanks,\n${sign}`,
        ),
      };
    default:
      return {
        subject: "A note from {artist}",
        body: lines(
          "Hi {first_name},",
          `${because}, so ${v.we} wanted to write to you directly.`,
          "[add your news]",
          `Thank you for listening, and for being part of this.\n${sign}`,
        ),
      };
  }
}
