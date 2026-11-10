// Add another entry here to enable cycling through more companions.
(function(root) {
  const pets = [
    { id: 'cat', name: '猫猫', frames: ['gif/1.png', 'gif/2.png', 'gif/3.png', 'gif/4.png'], duration: 240 },
    { id: 'cat2', name: '第二套素材', frames: ['gif/cat2/0.png', 'gif/cat2/1.png', 'gif/cat2/2.png', 'gif/cat2/3.png', 'gif/cat2/4.png'], duration: 240 },
    { id: 'cat3', name: '第三套素材', frames: ['gif/cat3/0.png', 'gif/cat3/1.png', 'gif/cat3/2.png', 'gif/cat3/3.png', 'gif/cat3/4.png'], duration: 240 },
  ];
  if (typeof module === 'object' && module.exports) module.exports = pets;
  else root.TREEHOLE_PETS = pets;
})(globalThis);
