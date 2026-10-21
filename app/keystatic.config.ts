import { config, fields, collection } from "@keystatic/core";
import { BLOG_POST_TYPES, BLOG_POST_TYPE_LABELS } from "@/helpers/blog/post-types";

export default config({
  storage: {
    kind: "local",
  },
  collections: {
    posts: collection({
      label: "Posts",
      slugField: "title",
      path: "app/content/posts/*",
      format: { contentField: "content" },
      schema: {
        title: fields.slug({ name: { label: "Title" } }),
        publishedAt: fields.date({
          label: "Published on",
          defaultValue: { kind: "today" },
          validation: { isRequired: true },
        }),
        // Who the post is for. Drives the blog filter and the post's CTA.
        type: fields.select({
          label: "Audience",
          options: BLOG_POST_TYPES.map((value) => ({
            label: BLOG_POST_TYPE_LABELS[value],
            value,
          })),
          defaultValue: "job-seekers",
        }),
        image: fields.image({
          label: "Image",
          directory: "public/images/posts",
          publicPath: "/images/posts/",
        }),
        content: fields.markdoc({ label: "Content" }),
      },
    }),
  },
});
