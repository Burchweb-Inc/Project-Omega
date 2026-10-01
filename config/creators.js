// config/creators.js
// Edit the creator section content here. This data is injected into the
// about page template so you never have to touch EJS markup to change
// names, logos, taglines, or links.

module.exports = {
  // Section heading that appears above the logo row
  heading: 'Built by BurchWeb.',

  // Caption line rendered below the logo row
  caption: 'Built by the same idiots behind SnarkyType',

  // Ordered list of creators shown left-to-right
  creators: [
    {
      name: 'BurchWeb',
      url: 'https://burchweb.com',
      logo: {
        src: 'https://snarkytype.sirv.com/Images/New%20Logo%20(Just%20Text).svg',
        alt: 'BurchWeb logo',
      },
    },
    {
      name: 'SnarkyType',
      url: 'https://snarkytype.com',
      logo: {
        src: '/media/logo-text.png',
        alt: 'SnarkyType logo',
      },
    },
  ],
};