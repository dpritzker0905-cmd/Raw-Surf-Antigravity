import React, { StrictMode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import usePointDetailsDisclosure from './usePointDetailsDisclosure';

function Card({compact=true, hidden=false, onEscape}) {
  const {detailsExpanded,setDetailsExpanded,detailsRef,onDetailsKeyDown}=usePointDetailsDisclosure();
  return <div role="presentation" onKeyDown={onEscape} data-responsive-weather="true" data-point-details-compact={String(compact)}>
    <div role="presentation" ref={detailsRef} onKeyDown={onDetailsKeyDown}>
      <button className="weather-point-details-toggle" data-testid="details" style={{display:compact&&!hidden?'block':'none'}}
        aria-expanded={detailsExpanded} onClick={()=>setDetailsExpanded(!detailsExpanded)}>Details</button>
      <button className="weather-point-header">Forecast header</button><button>Curve</button>
    </div>
  </div>;
}
test('expanded compact details reset on layout exit and hidden-toggle focus returns to the visible header under StrictMode',async()=>{
  const view=render(<StrictMode><Card/></StrictMode>);const details=screen.getByTestId('details');
  fireEvent.click(details);details.focus();expect(details).toHaveAttribute('aria-expanded','true');
  await act(async()=>{view.rerender(<StrictMode><Card compact={false}/></StrictMode>);await Promise.resolve();});
  expect(details).toHaveAttribute('aria-expanded','false');expect(screen.getByRole('button',{name:'Forecast header'})).toHaveFocus();
  view.rerender(<StrictMode><Card/></StrictMode>);expect(details).toHaveAttribute('aria-expanded','false');
});
test.each([false,true])('Escape returns focus and is consumed only when the toggle is visible (hidden=%s)',hidden=>{
  const escape=jest.fn();render(<Card hidden={hidden} onEscape={escape}/>);
  const details=screen.getByTestId('details');fireEvent.click(details);
  const curve=screen.getByRole('button',{name:'Curve'});curve.focus();fireEvent.keyDown(curve,{key:'Escape'});
  expect(details).toHaveAttribute('aria-expanded','false');
  if(hidden){expect(curve).toHaveFocus();expect(escape).toHaveBeenCalledTimes(1);}
  else {expect(details).toHaveFocus();expect(escape).not.toHaveBeenCalled();}
});
