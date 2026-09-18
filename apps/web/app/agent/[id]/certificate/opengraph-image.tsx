/**
 * The certificate's share card — the same drawing as the dossier's, declared
 * again here because Next resolves image files per segment and this is the link
 * people actually share.
 */

import { renderAgentOgImage } from '../og';

export const alt = 'Solvent — certificate of insolvency';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function CertificateOpengraphImage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return renderAgentOgImage(id);
}
