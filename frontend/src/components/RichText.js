/**
 * RichText - Renders text with clickable #hashtags and @mentions
 * 
 * Best practices from social media:
 * - Instagram: #hashtags are blue/teal, clickable to hashtag search
 * - Twitter/X: #hashtags and @mentions are blue, clickable
 * - TikTok: #hashtags are bold, clickable
 * 
 * Our implementation:
 * - #hashtags: Cyan color, navigate to /explore?hashtag={tag}
 * - @mentions: Blue color, navigate to /profile/{username}
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';

// Regex patterns for matching
const HASHTAG_REGEX = /#(\w+)/g;
const MENTION_REGEX = /@(\w+)/g;
const URL_REGEX = /(https?:\/\/[^\s]+)/g;

/**
 * Parse text and return array of segments with type information
 */
const parseText = (text) => {
  if (!text) return [];
  
  const segments = [];
  let lastIndex = 0;
  
  // Combine all patterns with their types
  const patterns = [
    { regex: HASHTAG_REGEX, type: 'hashtag' },
    { regex: MENTION_REGEX, type: 'mention' },
    { regex: URL_REGEX, type: 'url' }
  ];
  
  // Find all matches with their positions
  const matches = [];
  
  patterns.forEach(({ regex, type }) => {
    let match;
    const re = new RegExp(regex.source, 'g');
    while ((match = re.exec(text)) !== null) {
      matches.push({
        type,
        match: match[0],
        value: match[1] || match[0], // Captured group or full match
        start: match.index,
        end: match.index + match[0].length
      });
    }
  });
  
  // Sort by position
  matches.sort((a, b) => a.start - b.start);
  
  // Remove overlapping matches (keep first one)
  const filteredMatches = [];
  let lastEnd = 0;
  for (const match of matches) {
    if (match.start >= lastEnd) {
      filteredMatches.push(match);
      lastEnd = match.end;
    }
  }
  
  // Build segments
  for (const match of filteredMatches) {
    // Add text before this match
    if (match.start > lastIndex) {
      segments.push({
        type: 'text',
        content: text.slice(lastIndex, match.start)
      });
    }
    
    // Add the match
    segments.push({
      type: match.type,
      content: match.match,
      value: match.value
    });
    
    lastIndex = match.end;
  }
  
  // Add remaining text
  if (lastIndex < text.length) {
    segments.push({
      type: 'text',
      content: text.slice(lastIndex)
    });
  }
  
  return segments;
};

/**
 * RichText Component
 * Renders text with interactive hashtags and mentions
 */
export const RichText = ({ 
  text, 
  className = '',
  hashtagClassName = 'text-cyan-400 hover:text-cyan-300 hover:underline cursor-pointer',
  mentionClassName = 'text-blue-400 hover:text-blue-300 hover:underline cursor-pointer',
  urlClassName = 'text-cyan-400 hover:underline cursor-pointer',
  onHashtagClick,
  onMentionClick,
  onUrlClick,
  maxLength,
  showExpand = false
}) => {
  const navigate = useNavigate();
  const [expanded, setExpanded] = React.useState(false);
  
  // Truncate if needed
  let displayText = text || '';
  let isTruncated = false;
  
  if (maxLength && !expanded && displayText.length > maxLength) {
    displayText = displayText.slice(0, maxLength);
    isTruncated = true;
  }
  
  const segments = parseText(displayText);
  
  const handleHashtagClick = (e, tag) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (onHashtagClick) {
      onHashtagClick(tag);
    } else {
      navigate(`/explore?hashtag=${encodeURIComponent(tag)}`);
    }
  };
  
  const handleMentionClick = async (e, username) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (onMentionClick) {
      onMentionClick(username);
      return;
    }
    
    // Lookup username to get user ID, then navigate
    try {
      const response = await fetch(
        `${process.env.REACT_APP_BACKEND_URL}/api/username/lookup/${encodeURIComponent(username)}`
      );
      
      if (response.ok) {
        const user = await response.json();
        navigate(`/profile/${user.id}`);
      } else {
        // Fallback: navigate with username
        navigate(`/user/${encodeURIComponent(username)}`);
      }
    } catch (error) {
      // Fallback: navigate with username
      navigate(`/user/${encodeURIComponent(username)}`);
    }
  };
  
  const handleUrlClick = (e, url) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (onUrlClick) {
      onUrlClick(url);
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };
  
  return (
    <span className={className}>
      {segments.map((segment, index) => {
        switch (segment.type) {
          case 'hashtag':
            return (
              <span
                key={index}
                className={hashtagClassName}
                onClick={(e) => handleHashtagClick(e, segment.value)}
                data-testid={`hashtag-${segment.value}`}
                role="link"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && handleHashtagClick(e, segment.value)}
              >
                {segment.content}
              </span>
            );
          
          case 'mention':
            return (
              <span
                key={index}
                className={mentionClassName}
                onClick={(e) => handleMentionClick(e, segment.value)}
                data-testid={`mention-${segment.value}`}
                role="link"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && handleMentionClick(e, segment.value)}
              >
                {segment.content}
              </span>
            );
          
          case 'url':
            return (
              <span
                key={index}
                className={urlClassName}
                onClick={(e) => handleUrlClick(e, segment.content)}
                data-testid={`url-link`}
                role="link"
                tabIndex={0}
              >
                {segment.content.length > 30 
                  ? segment.content.slice(0, 30) + '...' 
                  : segment.content}
              </span>
            );
          
          default:
            return <span key={index}>{segment.content}</span>;
        }
      })}
      
      {isTruncated && (
        <>
          {'... '}
          {showExpand && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(true);
              }}
              className="text-muted-foreground hover:text-foreground text-sm"
            >
              more
            </button>
          )}
        </>
      )}
    </span>
  );
};

/**
 * Caption Component
 * Pre-styled for post captions with author name
 */
export const Caption = ({
  authorName,
  authorId,
  text,
  maxLength = 150,
  className = '',
  textPrimaryClass = 'text-foreground',
  textSecondaryClass = 'text-muted-foreground'
}) => {
  const navigate = useNavigate();
  
  return (
    <p className={`${textPrimaryClass} ${className}`}>
      <span 
        className="font-medium cursor-pointer hover:underline"
        onClick={(e) => {
          e.stopPropagation();
          if (authorId) navigate(`/profile/${authorId}`);
        }}
      >
        {authorName}
      </span>{' '}
      <RichText 
        text={text}
        className={textSecondaryClass}
        maxLength={maxLength}
        showExpand={true}
      />
    </p>
  );
};

/**
 * CommentText Component
 * For rendering comment text with interactive elements
 */
export const CommentText = ({
  text,
  className = 'text-sm',
  textClass = 'text-foreground'
}) => {
  return (
    <RichText 
      text={text}
      className={`${className} ${textClass}`}
    />
  );
};

export default RichText;
