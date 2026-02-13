import {
  trigger,
  transition,
  style,
  query,
  animate,
} from '@angular/animations';

export const fadeAnimation = trigger('fadeAnimation', [
  transition('* => *', [
    style({ position: 'relative', minHeight: '100%' }),
    query(
      ':enter, :leave',
      [
        style({
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }),
      ],
      { optional: true }
    ),
    query(':enter', [style({ opacity: 0 })], { optional: true }),
    query(
      ':leave',
      [animate('150ms ease-in', style({ opacity: 0 }))],
      { optional: true }
    ),
    query(
      ':enter',
      [animate('250ms ease-out', style({ opacity: 1 }))],
      { optional: true }
    ),
  ]),
]);
