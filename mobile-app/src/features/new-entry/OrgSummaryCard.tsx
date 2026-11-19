import { Pressable, Text, View, type ViewStyle } from 'react-native';
import { newEntryStyles as styles } from './styles';

type Props = {
  organizationName: string;
  organizationAddress: string;
  meta?: string | null;
  onPress?: () => void;
  selected?: boolean;
  footer?: string | null;
  variant?: 'card' | 'header';
  style?: ViewStyle;
};

export default function OrgSummaryCard({
  organizationName,
  organizationAddress,
  meta,
  onPress,
  selected,
  footer,
  variant = 'card',
  style,
}: Props) {
  const isHeader = variant === 'header';

  const content = (
    <>
      <Text style={isHeader ? styles.orgHeaderName : styles.orgName}>
        <Text style={isHeader ? styles.orgHeaderPrefix : styles.orgPrefix}></Text>
        {organizationName}
      </Text>
      <Text style={isHeader ? styles.orgHeaderAddress : styles.orgAddress}>{organizationAddress}</Text>
      {meta ? <Text style={isHeader ? styles.orgHeaderMeta : styles.orgMeta}>{meta}</Text> : null}
      {footer ? <Text style={styles.openHint}>{footer}</Text> : null}
    </>
  );

  const containerStyle = isHeader
    ? [styles.orgHeader, style]
    : [styles.orgCard, selected && styles.flyerCardSelected, style];

  if (onPress) {
    return (
      <Pressable style={containerStyle} onPress={onPress}>
        {content}
      </Pressable>
    );
  }

  return <View style={containerStyle}>{content}</View>;
}
