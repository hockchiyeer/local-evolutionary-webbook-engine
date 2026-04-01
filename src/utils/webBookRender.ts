/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Chapter } from '../types';

export interface RenderableDefinition {
  term: string;
  description: string;
  sourceUrl: string;
}

export interface RenderableSubTopic {
  title: string;
  summary: string;
  sourceUrl: string;
}

export interface ChapterRenderPlan {
  chapter: Chapter;
  titlePageNumber: number;
  analysisPageNumber: number | null;
  renderableDefinitions: RenderableDefinition[];
  renderableSubTopics: RenderableSubTopic[];
}

export function buildChapterRenderPlan(chapters: Chapter[]): ChapterRenderPlan[] {
  let currentPage = 3; // TOC is page 2
  return chapters.map((chapter) => {
    const titlePage = currentPage;
    const analysisPage = currentPage + 1;
    currentPage += 2;
    return {
      chapter,
      titlePageNumber: titlePage,
      analysisPageNumber: analysisPage,
      renderableDefinitions: chapter.definitions || [],
      renderableSubTopics: chapter.subTopics || [],
    };
  });
}
