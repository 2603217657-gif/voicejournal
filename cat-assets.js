// Add another entry here to enable cycling through more companions.
(function(root) {
  const pets = [
    { id: 'cat', name: '猫猫', frames: ['gif/1.jpg', 'gif/2.jpg', 'gif/3.jpg', 'gif/4.jpg'], duration: 240 },
    { id: 'cat2', name: '第二套素材', frames: ['gif/cat2/1.jpg', 'gif/cat2/2.jpg', 'gif/cat2/3.jpg', 'gif/cat2/4.jpg'], duration: 240 },
  ];
  if (typeof module === 'object' && module.exports) module.exports = pets;
  else root.TREEHOLE_PETS = pets;
})(globalThis);
