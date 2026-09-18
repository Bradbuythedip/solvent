/**
 * The dossier's share card. The drawing lives in ./og so the certificate route
 * can declare the same image: Next does not pass a parent segment's image file
 * down to a nested one.
 */

import { renderAgentOgImage } from './og';

export const alt = 'Solvent — an agent, earned minus burned';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function OpengraphImage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return renderAgentOgImage(id);
}
