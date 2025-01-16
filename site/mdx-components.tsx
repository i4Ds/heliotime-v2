import type { MDXComponents } from 'mdx/types';

export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    ...components,
    // eslint-disable-next-line react/jsx-props-no-spreading
    wrapper: ({ className='', ...rest }) => <div {...rest} className={`prose ${className}`} />,
  };
}
