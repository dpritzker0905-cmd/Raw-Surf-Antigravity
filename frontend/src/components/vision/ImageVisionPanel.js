import React, { useEffect, useRef, useState } from 'react';
import apiClient from '../../lib/apiClient';
import { getFullUrl } from '../../utils/media';
import { Button } from '../ui/button';
import { useThemeName } from '../../contexts/ThemeContext';
import { BoardClueReview } from './BoardClueReview';

// One explicit scan per photo: never batch paid requests or infer profile identities.
export const ImageVisionPanel = ({ images, kind = 'photo', boardId, onApply, includeBoardClues = false, onReviewPhoto }) => {
  const theme = useThemeName();
  const photoFieldTheme = theme === 'beach' ? 'bg-amber-50 text-amber-900' : 'bg-background text-foreground';
  const [selectedId, setSelectedId] = useState('');
  const [analysis, setAnalysis] = useState(null);
  const [boardReview, setBoardReview] = useState(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const request = useRef(0);
  const busy = useRef(false);
  const image = images.find(item => item.id === selectedId) || images[0];
  const imageId = image?.id;
  const imageUrl = image?.url;
  const isBoard = kind === 'board';

  useEffect(() => {
    request.current += 1;
    busy.current = false;
    setAnalysis(null);
    setBoardReview(null);
    setError('');
    setPending(false);
    return () => { request.current += 1; };
  }, [imageId, imageUrl, kind, boardId, includeBoardClues]);

  const scan = async () => {
    if (!imageUrl || busy.current) return;
    const version = ++request.current;
    busy.current = true;
    setPending(true);
    setError('');
    setAnalysis(null);
    setBoardReview(null);
    try {
      const payload = isBoard
        ? { image_url: imageUrl, ...(boardId ? { surfboard_id: boardId } : {}) }
        : { image_url: imageUrl, gallery_item_id: imageId, ...(includeBoardClues ? { include_board_clues: true } : {}) };
      const { data } = await apiClient.post(isBoard ? '/ai/scan-surfboard' : '/ai/suggest-tags', payload);
      if (version !== request.current) return;
      if (!data.success || !data.analysis || typeof data.analysis !== 'object') {
        throw new Error('Image analysis did not return a result.');
      }
      setAnalysis(data.analysis);
      if (!isBoard && includeBoardClues) setBoardReview({
        clues: data.board_clues || [], status: data.board_clue_status,
        truncated: data.board_clues_truncated, people: data.analysis.people || [],
      });
    } catch (failure) {
      if (version === request.current) {
        const detail = failure.response?.data?.detail;
        setError(typeof detail === 'string' ? detail : 'Image analysis is unavailable. Please try again later.');
      }
    } finally {
      if (version === request.current) {
        busy.current = false;
        setPending(false);
      }
    }
  };

  return (
    <section aria-label={isBoard ? 'Surfboard analysis' : 'Photo analysis'}
      className="space-y-3 rounded-xl border border-border bg-muted p-3 text-foreground">
      <h3 className="font-semibold">{isBoard ? 'Surfboard analysis' : 'Photo analysis & visual tags'}</h3>
      {image ? <>
        <label className="block text-sm">
          {isBoard ? 'Board photo to scan' : 'Photo to analyze'}
          <select aria-label={isBoard ? 'Board photo to scan' : 'Photo to analyze'}
            value={image.id} onChange={event => setSelectedId(event.target.value)}
            className={`mt-1 block w-full rounded border border-border p-2 ${photoFieldTheme}`}>
            {images.map((item, index) => <option key={item.id} value={item.id} className={photoFieldTheme}>
              {item.label || `Photo ${index + 1}`}
            </option>)}
          </select>
        </label>
        <img src={getFullUrl(image.url)} alt={isBoard ? 'Board selected for scanning' : 'Photo selected for analysis'}
          className="mx-auto max-h-40 w-full rounded object-contain" />
      </> : <p className="text-sm">{isBoard ? 'Upload a board photo to scan.' : 'Choose a folder with photos. Videos cannot be scanned.'}</p>}
      <p className="text-xs text-muted-foreground">
        {isBoard
          ? 'Scanning sends this photo to OpenAI. Review suggestions before saving; measurements are not estimated.'
          : includeBoardClues
            ? 'Scanning sends one photo to OpenAI. Visible board details are compared locally with linked participants’ saved boards for manual review. Saved boards and profiles are not sent to OpenAI.'
            : 'Scanning sends one photo to OpenAI for a description and visual tags. Select known surfers manually; faces are not matched to profiles.'}
      </p>
      <Button type="button" variant="outline" disabled={!image || pending} onClick={scan}>
        {pending ? 'Scanning…' : isBoard ? 'Scan Surfboard' : 'Scan Photo'}
      </Button>
      {pending && <p role="status">Analyzing photo…</p>}
      {error && <p role="alert" className="text-sm">{error}</p>}
      {analysis && <div role="status" className="space-y-2 text-sm">
        {isBoard ? <>
          {!analysis.board_detected ? <p>No surfboard detected. Try another photo.</p> : <>
            <p>{analysis.description}</p>
            <dl className="grid grid-cols-2 gap-2">
              {['brand', 'model', 'board_type', 'fin_setup', 'tail_shape'].map(field => <React.Fragment key={field}>
                <dt>{field.replace(/_/g, ' ')}</dt><dd>{analysis[field] || 'Not detected'}</dd>
              </React.Fragment>)}
            </dl>
            <p>Visible text: {analysis.visible_text?.join(', ') || 'None detected'}</p>
            <Button type="button" variant="outline" onClick={() => onApply(analysis)}>Use suggestions in empty fields</Button>
            <p className="text-xs text-muted-foreground">Entered details stay unchanged. Save the form to keep your changes.</p>
          </>}
        </> : <>
          <p>{analysis.overall_description}</p>
          <p>{analysis.people_count} people detected. Suggested visual tags:</p>
          <ul aria-label="Suggested visual tags" className="flex flex-wrap gap-2">
            {analysis.visual_tags?.map((tag, index) => <li key={`${index}-${tag}`} className="rounded border border-border px-2 py-1">{tag}</li>)}
          </ul>
          <p className="text-xs text-muted-foreground">These descriptions do not identify people. Use manual assignment below.</p>
          {boardReview && <BoardClueReview {...boardReview} />}
          {boardReview && onReviewPhoto && <>
            <p className="text-xs text-muted-foreground">Board clues apply only to the photo shown. Limit the selection before assigning it to a surfer.</p>
            <Button type="button" variant="outline" className="h-auto whitespace-normal text-left"
              onClick={() => onReviewPhoto(imageId)}>Use only this photo for manual assignment</Button>
          </>}
        </>}
      </div>}
    </section>
  );
};
