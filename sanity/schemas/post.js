export default {
  name: "post",
  title: "Post",
  type: "document",
  fields: [
    {
      name: "title",
      title: "Title",
      type: "string",
      validation: (Rule) => Rule.required()
    },
    {
      name: "slug",
      title: "Slug",
      type: "slug",
      options: { source: "title", maxLength: 96 },
      validation: (Rule) => Rule.required()
    },
    {
      name: "date",
      title: "Published date",
      type: "datetime",
      validation: (Rule) => Rule.required()
    },
    {
      name: "location",
      title: "Location",
      type: "string"
    },
    {
      name: "category",
      title: "Category",
      type: "string",
      options: {
        list: [
          { title: "Arrivals", value: "Arrivals" },
          { title: "Food", value: "Food" },
          { title: "Enlightenment", value: "Enlightenment" },
          { title: "Thoughts", value: "Thoughts" },
          { title: "Packing / Buying / Spending", value: "Packing / Buying / Spending" }
        ]
      }
    },
    {
      name: "readTime",
      title: "Read time",
      type: "string"
    },
    {
      name: "excerpt",
      title: "Excerpt",
      type: "text",
      rows: 3,
      validation: (Rule) => Rule.max(180)
    },
    {
      name: "dek",
      title: "Hero tagline",
      type: "string",
      description: "Large gold intro line displayed above the body copy."
    },
    {
      name: "seoTitle",
      title: "SEO title",
      type: "string",
      validation: (Rule) => Rule.max(70)
    },
    {
      name: "seoDescription",
      title: "SEO description",
      type: "text",
      rows: 3,
      validation: (Rule) => Rule.max(160)
    },
    {
      name: "keywords",
      title: "Keywords",
      type: "array",
      of: [{ type: "string" }]
    },
    {
      name: "image",
      title: "Social image",
      type: "image"
    },
    {
      name: "body",
      title: "Body",
      type: "array",
      of: [{ type: "block" }]
    }
  ],
  preview: {
    select: {
      title: "title",
      subtitle: "location",
      media: "image"
    }
  }
};
