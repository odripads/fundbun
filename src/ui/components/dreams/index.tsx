/**
 * Dream items: the editor (name, price, goal/treat, preset illustration or on-device photo) shared by onboarding
 * and Goals, plus its pure helpers. Keep the DreamEditor name and props stable — Goals reuses it.
 */
export { DreamEditor, type DreamEditorProps } from './DreamEditor'
export {
  DREAM_SUGGESTIONS,
  KIND_COPY,
  PRESET_LABELS,
  PRESETS,
  fitWithin,
  guessPreset,
  parsePrice,
  presetImage,
  priceText,
  validateDreamForm,
  type DreamFormErrors,
  type DreamFormValues,
  type DreamSuggestion,
  type PriceResult,
} from './logic'
export { MAX_PHOTO_PX, PhotoError, photoFileProblem, photoToDataUrl } from './photo'
