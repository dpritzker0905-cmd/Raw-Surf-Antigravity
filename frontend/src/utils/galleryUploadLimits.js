export function galleryVideoLimitMiB(tier) {
  if (tier === 'premium') return 200;
  if (tier === 'basic') return 100;
  return 50;
}
