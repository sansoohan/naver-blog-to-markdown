// category/index.js
const category = require("./category");
const categorySearch = require("./category-search");
const categoryChange = require("./category-change");

module.exports = {
  ...category,
  ...categorySearch,
  ...categoryChange,
};