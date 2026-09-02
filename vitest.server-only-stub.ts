// The real `server-only` package throws unconditionally unless resolved under
// Next's `react-server` module condition, which Next's webpack/turbopack build
// sets and Vitest does not. Vitest aliases the bare specifier here instead of
// setting that condition globally, because doing so would also swap React
// itself for its server build and break every test that renders a component.
export {};
