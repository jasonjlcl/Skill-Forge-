import type { Response } from 'express';

const activeStreams = new Set<Response>();

export const registerSseConnection = (res: Response): void => {
  activeStreams.add(res);
  res.on('close', () => {
    activeStreams.delete(res);
  });
};

export const closeAllSseConnections = (): number => {
  const streams = [...activeStreams];
  for (const stream of streams) {
    if (!stream.writableEnded) {
      stream.end();
    }
    activeStreams.delete(stream);
  }

  return streams.length;
};

export const getSseConnectionCount = (): number => activeStreams.size;
