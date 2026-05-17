import { useEffect } from 'react';

export var useMapSeo = () => {
  useEffect(() => {
    const ogTags = [];
    const setMeta = (property, content) => {
      if (!content) return;
      let tag = document.querySelector(`meta[property="${property}"]`);
      if (!tag) {
        tag = document.createElement('meta');
        tag.setAttribute('property', property);
        document.head.appendChild(tag);
        ogTags.push(tag);
      }
      tag.setAttribute('content', content);
    };
    document.title = 'Surf Map - Raw Surf';
    setMeta('og:title', 'Surf Map - Raw Surf');
    setMeta('og:description', 'Live surf spot map with real-time photographer locations, conditions, and on-demand booking on Raw Surf.');
    setMeta('og:url', `${window.location.origin}/map`);
    setMeta('og:type', 'website');
    setMeta('og:site_name', 'Raw Surf');
    return () => {
      document.title = 'Raw Surf';
      ogTags.forEach(tag => tag.remove());
    };
  }, []);
};
