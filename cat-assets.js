// Add another entry here to enable cycling through more companions.
(function(root) {
  const pets = [
    { id: 'cat', name: '猫猫', frames: ['gif/1.jpg', 'gif/2.jpg', 'gif/3.jpg', 'gif/4.jpg'], duration: 240 },
  ];
  if (typeof module === 'object' && module.exports) module.exports = pets;
  else root.TREEHOLE_PETS = pets;
})(globalThis);
