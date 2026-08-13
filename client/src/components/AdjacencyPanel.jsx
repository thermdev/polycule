import { useEffect, useState } from 'react';
import { graphToAdjacency } from '../state/graph.js';
import { applyAdjacency, useStore } from '../state/store.js';
import { Button } from './ui.jsx';

const SAMPLE = `A-B
A-C
A-D
B-C
C-D
D-E
E-F
F-A`;

export function AdjacencyPanel({ sceneRef }) {
  const graph = useStore((s) => s.graph);
  const [text, setText] = useState(() => graphToAdjacency(graph));
  const [edited, setEdited] = useState(false);
  const [errors, setErrors] = useState([]);

  // Mirror graph changes made elsewhere, unless there are unapplied edits.
  useEffect(() => {
    if (!edited) setText(graphToAdjacency(graph));
  }, [graph, edited]);

  function apply(source = text) {
    const problems = applyAdjacency(source);
    setErrors(problems);
    setEdited(false);
    // Wait for the scene to take the new graph, then lay it out and frame it.
    requestAnimationFrame(() => sceneRef.current?.settleAndFrame());
  }

  return (
    <div className="panel-body">
      <p className="panel-note">
        One connection per line, as <code>Name-Name</code>. Reversed duplicates
        (<code>A-B</code> and <code>B-A</code>) collapse into one. A line with a
        single name adds someone unattached, and <code>A-B-C</code> chains.
      </p>

      <textarea
        className="adjacency-input"
        spellCheck={false}
        value={text}
        placeholder={SAMPLE}
        onChange={(event) => {
          setText(event.target.value);
          setEdited(true);
        }}
      />

      {errors.length ? (
        <ul className="error-list">
          {errors.slice(0, 5).map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      ) : null}

      <div className="button-row">
        <Button variant="primary" onClick={() => apply()}>
          Apply {edited ? '•' : ''}
        </Button>
        <Button
          onClick={() => {
            setText(graphToAdjacency(graph));
            setEdited(false);
            setErrors([]);
          }}
        >
          Revert
        </Button>
        <Button
          onClick={() => {
            setText(SAMPLE);
            setEdited(true);
          }}
        >
          Sample
        </Button>
      </div>

      <p className="panel-note dim">
        Applying keeps the colours, images and positions of anyone whose name is
        unchanged.
      </p>
    </div>
  );
}
