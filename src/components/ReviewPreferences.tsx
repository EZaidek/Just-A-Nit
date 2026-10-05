import { useState } from 'react';
import {
  DEFAULT_FILTERS, LANGUAGES, MAX_FILES, MAX_LINES, MAX_TOPICS, TOPIC_PATTERN,
  validateFilters, type ReviewFilters,
} from '../lib/preferences';

type Props = {
  filters: ReviewFilters;
  onChange: (filters: ReviewFilters) => void;
  topics: string[];
  topicsLoading: boolean;
  topicsError: string;
  disabled: boolean;
};

export default function ReviewPreferences({ filters, onChange, topics, topicsLoading, topicsError, disabled }: Props) {
  const [topicDraft, setTopicDraft] = useState('');
  const [topicError, setTopicError] = useState('');
  const validation = validateFilters(filters);
  const suggestions = topics.filter(topic => !filters.topics.includes(topic) && topic.includes(topicDraft.toLowerCase().trim()));

  function addTopic(value: string) {
    const topic = value.toLowerCase().trim();
    if (!TOPIC_PATTERN.test(topic)) {
      setTopicError('Use a GitHub topic name: letters, numbers, and hyphens, up to 50 characters.');
      return;
    }
    if (filters.topics.length >= MAX_TOPICS) {
      setTopicError(`Choose up to ${MAX_TOPICS} tags.`);
      return;
    }
    if (!filters.topics.includes(topic)) onChange({ ...filters, topics: [...filters.topics, topic] });
    setTopicDraft('');
    setTopicError('');
  }

  return (
    <fieldset className="preferences" disabled={disabled}>
      <legend>Review preferences</legend>
      <div className="preferences-heading">
        <p>Choose what to practice. Preferences apply to your next review.</p>
        <button type="button" className="quiet-button" onClick={() => {
          onChange({ ...DEFAULT_FILTERS }); setTopicDraft(''); setTopicError('');
        }}>Reset preferences</button>
      </div>
      <div className="size-settings">
        <fieldset className="range-group">
          <legend>Changed lines</legend>
          <div className="range-inputs">
            <label>Minimum<input type="number" min={1} max={MAX_LINES} step={1} value={filters.minLines || ''}
              onChange={event => onChange({ ...filters, minLines: Number(event.target.value) })} /></label>
            <span aria-hidden="true">to</span>
            <label>Maximum<input type="number" min={1} max={MAX_LINES} step={1} value={filters.maxLines || ''}
              onChange={event => onChange({ ...filters, maxLines: Number(event.target.value) })} /></label>
          </div>
          <p className="field-help">Added + removed lines, up to {MAX_LINES}.</p>
        </fieldset>
        <fieldset className="range-group">
          <legend>Changed files</legend>
          <div className="range-inputs">
            <label>Minimum<input type="number" min={1} max={MAX_FILES} step={1} value={filters.minFiles || ''}
              onChange={event => onChange({ ...filters, minFiles: Number(event.target.value) })} /></label>
            <span aria-hidden="true">to</span>
            <label>Maximum<input type="number" min={1} max={MAX_FILES} step={1} value={filters.maxFiles || ''}
              onChange={event => onChange({ ...filters, maxFiles: Number(event.target.value) })} /></label>
          </div>
          <p className="field-help">The whole pull request, up to {MAX_FILES} files.</p>
        </fieldset>
      </div>
      {validation && <p className="validation-error" role="alert">{validation}</p>}

      <fieldset className="language-settings">
        <legend>Languages <span className="selection-hint">{filters.languages.length ? `${filters.languages.length} selected` : 'Any language'}</span></legend>
        <p className="field-help">Choose any combination. Every changed file must be in one of your selected languages.</p>
        <div className="language-options">
          {LANGUAGES.map(language => (
            <label key={language.name} className="language-option">
              <input type="checkbox" checked={filters.languages.includes(language.name)} onChange={event => onChange({
                ...filters,
                languages: event.target.checked ? [...filters.languages, language.name]
                  : filters.languages.filter(name => name !== language.name),
              })} />
              {language.name}
            </label>
          ))}
        </div>
        {filters.languages.length > 0 && <button type="button" className="quiet-button clear-languages"
          onClick={() => onChange({ ...filters, languages: [] })}>Use any language</button>}
      </fieldset>

      <fieldset className="topic-settings">
        <legend>Repository tags <span className="selection-hint">{filters.topics.length ? `${filters.topics.length}/${MAX_TOPICS} selected` : 'Any topic'}</span></legend>
        <p className="field-help">GitHub topics from the repository. A repository must have all selected tags. Reviews target its default branch.</p>
        {filters.topics.length > 0 && <div className="selected-topics" aria-label="Selected repository tags">
          {filters.topics.map(topic => <button type="button" className="topic-chip selected" key={topic}
            aria-label={`Remove tag ${topic}`} onClick={() => onChange({ ...filters, topics: filters.topics.filter(value => value !== topic) })}>
            {topic} <span aria-hidden="true">×</span>
          </button>)}
        </div>}
        <div className="topic-entry">
          <label htmlFor="topic-input" className="sr-only">Find or enter a repository tag</label>
          <input id="topic-input" type="text" placeholder="Find or enter a tag, e.g. frontend" maxLength={50}
            value={topicDraft} onChange={event => { setTopicDraft(event.target.value); setTopicError(''); }}
            onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addTopic(topicDraft); } }} />
          <button type="button" className="secondary-button" disabled={!topicDraft.trim() || filters.topics.length >= MAX_TOPICS}
            onClick={() => addTopic(topicDraft)}>Add tag</button>
        </div>
        {topicError && <p className="validation-error" role="alert">{topicError}</p>}
        <div className="topic-options" aria-label="Suggested GitHub repository tags">
          {suggestions.slice(0, 24).map(topic => <button type="button" className="topic-chip" key={topic}
            disabled={filters.topics.length >= MAX_TOPICS} onClick={() => addTopic(topic)}>{topic}</button>)}
        </div>
        <p className="field-help" role="status">
          {topicsLoading ? 'Loading GitHub topics…' : topicsError ||
            (suggestions.length > 24 ? 'Type to find more tags from these repositories.' :
              'Suggestions come from public repositories for your language selection. You can also enter a GitHub topic.')}
        </p>
      </fieldset>
    </fieldset>
  );
}
