// The site's share image (app/opengraph-image.jpg, app/twitter-image.jpg).
//
// Next replaces the root layout's whole `openGraph` (and `twitter`) object as
// soon as a page sets its own, so a page that sets `openGraph` without
// `images` ends up with no og:image. Every page that sets `openGraph` or
// `twitter` spreads these in.

export const SHARE_IMAGE = {
  url: "/opengraph-image.jpg",
  width: 1200,
  height: 630,
  alt: "GetHired",
};

export const TWITTER_SHARE_IMAGE = {
  url: "/twitter-image.jpg",
  width: 1200,
  height: 675,
  alt: "GetHired",
};

export const shareImages = { images: [SHARE_IMAGE] };

export const twitterShareImages = {
  card: "summary_large_image" as const,
  images: [TWITTER_SHARE_IMAGE],
};
