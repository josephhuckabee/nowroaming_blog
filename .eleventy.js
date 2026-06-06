module.exports = function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy("css");
  eleventyConfig.addPassthroughCopy("images");
  eleventyConfig.addPassthroughCopy("js");

  eleventyConfig.addCollection("posts", function (collectionApi) {
    return collectionApi.getFilteredByGlob("posts/*.md").sort((a, b) => {
      return b.date - a.date;
    });
  });

  eleventyConfig.addFilter("readableDate", function (date) {
    return new Intl.DateTimeFormat("en", {
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC"
    }).format(date);
  });

  eleventyConfig.addFilter("isoDate", function (date) {
    return date instanceof Date ? date.toISOString() : new Date(date).toISOString();
  });

  eleventyConfig.addFilter("absoluteUrl", function (url, siteUrl) {
    return new URL(url, siteUrl).toString();
  });

  eleventyConfig.addFilter("json", function (value) {
    return JSON.stringify(value, null, 2);
  });

  return {
    dir: {
      input: ".",
      output: "_site",
      includes: "_includes"
    },
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
    templateFormats: ["html", "njk", "md"]
  };
};
